import type { MotionClip, MotionInterpolation, MotionTrack } from './animation';
import type { PoseKeyframe } from './rig';

export const PROJECT_VERSION = 5 as const;

export type LegacyCycle = {
  id: string;
  name: string;
  frames: number;
  timing: number;
  frameIds?: number[];
  loopMode?: 'loop' | 'once' | 'ping-pong';
};

export type LegacyFrame = {
  id: number;
  src: string;
  duration: number;
  provenance?: 'source' | 'key-pose' | 'guide' | 'authored' | 'deterministic' | 'generated' | 'refined';
};

export type MigratedRenderedVariant = {
  id: string;
  modelId: string;
  skinId: string | null;
  clipId: string;
  frameSources: string[];
  frameDurations: number[];
  provenance: Array<'authored' | 'deterministic' | 'generated' | 'refined'>;
};

export type MotionTargetCatalog = {
  joints: Iterable<string>;
  segments: Iterable<string>;
  attachments?: Iterable<string>;
};

export type OrphanedTrack = { clipId: string; trackId: string; targetKind: MotionTrack['targetKind']; targetId: string };
export type TrackValidation = { validClips: MotionClip[]; orphanedTracks: OrphanedTrack[] };
export type LegacyMotionData = { cycles?: LegacyCycle[]; frames?: LegacyFrame[]; poses?: PoseKeyframe[]; modelId: string; skinId?: string | null };
export type V5MotionMigration = { version: typeof PROJECT_VERSION; clips: MotionClip[]; renderedVariants: MigratedRenderedVariant[]; legacyPosePreviews: Record<string, string> };

const safeId = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
const trackId = (kind: MotionTrack['targetKind'], targetId: string, property: MotionTrack['property']) => `${kind}:${targetId}:${property}`;
const keyId = (poseId: string, property: string) => `key:${safeId(poseId)}:${property}`;
const provenance = (value: LegacyFrame['provenance']): MigratedRenderedVariant['provenance'][number] => {
  if (value === 'generated') return 'generated';
  if (value === 'refined') return 'refined';
  if (value === 'guide' || value === 'deterministic') return 'deterministic';
  if (value === 'authored') return 'authored';
  return 'authored';
};

function addPoseTrack(tracks: Map<string, MotionTrack>, pose: PoseKeyframe, kind: MotionTrack['targetKind'], targetId: string, property: MotionTrack['property'], value: number | boolean, interpolation: MotionInterpolation): void {
  const id = trackId(kind, targetId, property);
  const track = tracks.get(id) ?? { id, targetKind: kind, targetId, property, keyframes: [] };
  track.keyframes.push({ id: keyId(pose.id, `${kind}:${targetId}:${property}`), frame: Math.max(0, Math.round(pose.frameIndex)), value, interpolation });
  tracks.set(id, track);
}

/** Converts approved and draft legacy whole poses into sparse property tracks. */
export function legacyPosesToTracks(poses: PoseKeyframe[], interpolation: MotionInterpolation = 'linear'): MotionTrack[] {
  const tracks = new Map<string, MotionTrack>();
  for (const pose of [...poses].sort((a, b) => a.frameIndex - b.frameIndex || a.id.localeCompare(b.id))) {
    for (const [id, joint] of Object.entries(pose.joints)) {
      addPoseTrack(tracks, pose, 'joint', id, 'x', joint.x, interpolation);
      addPoseTrack(tracks, pose, 'joint', id, 'y', joint.y, interpolation);
    }
    for (const [id, transform] of Object.entries(pose.transforms)) {
      addPoseTrack(tracks, pose, 'segment', id, 'x', transform.x, interpolation);
      addPoseTrack(tracks, pose, 'segment', id, 'y', transform.y, interpolation);
      addPoseTrack(tracks, pose, 'segment', id, 'rotation', transform.rotation, interpolation);
      addPoseTrack(tracks, pose, 'segment', id, 'visible', transform.visible, 'stepped');
      if (transform.zIndex !== undefined) addPoseTrack(tracks, pose, 'segment', id, 'zIndex', transform.zIndex, 'stepped');
    }
  }
  return [...tracks.values()].map((track) => ({ ...track, keyframes: [...new Map(track.keyframes.map((key) => [key.frame, key])).values()].sort((a, b) => a.frame - b.frame) }));
}

export function legacyCycleToClip(cycle: LegacyCycle, poses: PoseKeyframe[] = []): MotionClip {
  const durationFrames = Math.max(1, Math.round(cycle.frames));
  const fps = Math.max(1, Math.round(1000 / Math.max(1, cycle.timing)));
  const cyclePoses = poses.filter((pose) => pose.cycleId === cycle.id);
  return {
    id: cycle.id,
    name: cycle.name,
    fps,
    durationFrames,
    defaultFrameDuration: Math.max(1, Math.round(cycle.timing)),
    loop: cycle.loopMode !== 'once',
    loopStart: 0,
    loopEnd: durationFrames - 1,
    tracks: legacyPosesToTracks(cyclePoses),
    events: [],
    approval: cyclePoses.some((pose) => !pose.approved) ? 'needs-review' : cyclePoses.length ? 'approved' : 'draft',
  };
}

export function migrateLegacyMotion(data: LegacyMotionData): V5MotionMigration {
  const framesById = new Map((data.frames ?? []).map((frame) => [frame.id, frame]));
  const clips = (data.cycles ?? []).map((cycle) => legacyCycleToClip(cycle, data.poses));
  const renderedVariants = (data.cycles ?? []).flatMap((cycle): MigratedRenderedVariant[] => {
    const frames = (cycle.frameIds ?? []).map((id) => framesById.get(id)).filter((frame): frame is LegacyFrame => Boolean(frame));
    if (!frames.length) return [];
    return [{ id: `variant:migrated:${safeId(cycle.id)}`, modelId: data.modelId, skinId: data.skinId ?? null, clipId: cycle.id, frameSources: frames.map((frame) => frame.src), frameDurations: frames.map((frame) => frame.duration), provenance: frames.map((frame) => provenance(frame.provenance)) }];
  });
  return { version: PROJECT_VERSION, clips, renderedVariants, legacyPosePreviews: Object.fromEntries((data.poses ?? []).filter((pose) => pose.preview).map((pose) => [pose.id, pose.preview])) };
}

/** Separates recoverable orphan tracks without silently discarding them. */
export function validateMotionTargets(clips: MotionClip[], catalog: MotionTargetCatalog): TrackValidation {
  const targets = { joint: new Set(catalog.joints), segment: new Set(catalog.segments), attachment: new Set(catalog.attachments ?? []) };
  const orphanedTracks: OrphanedTrack[] = [];
  const validClips = clips.map((clip) => ({ ...clip, tracks: clip.tracks.filter((track) => {
    const valid = targets[track.targetKind].has(track.targetId);
    if (!valid) orphanedTracks.push({ clipId: clip.id, trackId: track.id, targetKind: track.targetKind, targetId: track.targetId });
    return valid;
  }) }));
  return { validClips, orphanedTracks };
}
