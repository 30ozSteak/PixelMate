import type { RigJoint } from './rig';
import type { SegmentTransform } from './segmentation';

export type MotionTargetKind = 'joint' | 'segment' | 'attachment';
export type MotionProperty = 'x' | 'y' | 'rotation' | 'visible' | 'zIndex';
export type MotionInterpolation = 'stepped' | 'linear' | 'ease-in' | 'ease-out' | 'ease-both';
export type MotionValue = number | boolean;

export type MotionKeyframe = {
  id: string;
  frame: number;
  value: MotionValue;
  interpolation: MotionInterpolation;
};

export type MotionTrack = {
  id: string;
  targetKind: MotionTargetKind;
  targetId: string;
  property: MotionProperty;
  keyframes: MotionKeyframe[];
};

export type MotionEvent = { id: string; frame: number; name: string; payload?: string };
export type MotionApproval = 'draft' | 'approved' | 'needs-review';

export type MotionClip = {
  id: string;
  name: string;
  fps: number;
  durationFrames: number;
  defaultFrameDuration: number;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  tracks: MotionTrack[];
  events: MotionEvent[];
  approval: MotionApproval;
};

export type EvaluatedAttachment = { x: number; y: number; rotation: number; visible: boolean; zIndex: number };
export type EvaluatedPose = {
  frame: number;
  joints: Record<string, { x: number; y: number }>;
  transforms: Record<string, SegmentTransform>;
  attachments: Record<string, EvaluatedAttachment>;
  visibility: Record<string, boolean>;
};

export type DraftPose = {
  joints?: Record<string, Partial<{ x: number; y: number }>>;
  transforms?: Record<string, Partial<SegmentTransform>>;
  attachments?: Record<string, Partial<EvaluatedAttachment>>;
};

export type EditorPlaybackState = {
  playhead: number;
  playing: boolean;
  playbackRate: number;
  loopStart: number;
  loopEnd: number;
  autoKey: boolean;
  selectedKeyframeIds: string[];
  draftPose: DraftPose;
};

export type RestPose = {
  joints: Pick<RigJoint, 'id' | 'restX' | 'restY'>[];
  transforms?: Record<string, SegmentTransform>;
  attachments?: Record<string, EvaluatedAttachment>;
};

export type CapturedPose = {
  joints?: Record<string, { x: number; y: number }>;
  transforms?: Record<string, SegmentTransform>;
  attachments?: Record<string, EvaluatedAttachment>;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const frameIndex = (frame: number) => Math.max(0, Math.round(frame));
const keyId = () => `key-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const trackId = (kind: MotionTargetKind, targetId: string, property: MotionProperty) => `${kind}:${targetId}:${property}`;

export function shortestRotationDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

export function interpolationProgress(interpolation: MotionInterpolation, progress: number): number {
  const t = clamp(progress, 0, 1);
  if (interpolation === 'stepped') return 0;
  if (interpolation === 'ease-in') return t * t;
  if (interpolation === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (interpolation === 'ease-both') return t * t * (3 - 2 * t);
  return t;
}

export function evaluateTrack(track: MotionTrack, frame: number): MotionValue | undefined {
  const keys = [...track.keyframes].sort((a, b) => a.frame - b.frame);
  if (!keys.length) return undefined;
  const at = frameIndex(frame);
  if (at <= keys[0].frame) return keys[0].value;
  const rightIndex = keys.findIndex((key) => key.frame >= at);
  if (rightIndex < 0) return keys[keys.length - 1].value;
  const right = keys[rightIndex];
  if (right.frame === at) return right.value;
  const left = keys[rightIndex - 1];
  if (typeof left.value === 'boolean' || typeof right.value === 'boolean' || left.interpolation === 'stepped') return left.value;
  const progress = interpolationProgress(left.interpolation, (at - left.frame) / (right.frame - left.frame));
  const delta = track.property === 'rotation' ? shortestRotationDelta(left.value, right.value) : right.value - left.value;
  return left.value + delta * progress;
}

export function upsertKeyframe(track: MotionTrack, keyframe: Omit<MotionKeyframe, 'id'> & { id?: string }): MotionTrack {
  const frame = frameIndex(keyframe.frame);
  const existing = track.keyframes.find((key) => key.frame === frame);
  const next: MotionKeyframe = { ...keyframe, id: keyframe.id ?? existing?.id ?? keyId(), frame };
  return { ...track, keyframes: [...track.keyframes.filter((key) => key.frame !== frame), next].sort((a, b) => a.frame - b.frame) };
}

export function deleteKeyframes(track: MotionTrack, ids: Iterable<string>): MotionTrack {
  const removed = new Set(ids);
  return { ...track, keyframes: track.keyframes.filter((key) => !removed.has(key.id)) };
}

export function moveKeyframes(track: MotionTrack, ids: Iterable<string>, frameDelta: number): MotionTrack {
  const selected = new Set(ids);
  const moved = track.keyframes.filter((key) => selected.has(key.id)).map((key) => ({ ...key, frame: frameIndex(key.frame + frameDelta) }));
  const occupied = new Set(moved.map((key) => key.frame));
  const stationary = track.keyframes.filter((key) => !selected.has(key.id) && !occupied.has(key.frame));
  const collisionWinners = new Map<number, MotionKeyframe>();
  for (const key of moved) collisionWinners.set(key.frame, key);
  return { ...track, keyframes: [...stationary, ...collisionWinners.values()].sort((a, b) => a.frame - b.frame) };
}

function applyTrack(pose: EvaluatedPose, track: MotionTrack, value: MotionValue): void {
  if (track.targetKind === 'joint') {
    if (track.property !== 'x' && track.property !== 'y') return;
    const joint = pose.joints[track.targetId] ?? { x: 0, y: 0 };
    joint[track.property] = Number(value);
    pose.joints[track.targetId] = joint;
    return;
  }
  const defaults: EvaluatedAttachment = { x: 0, y: 0, rotation: 0, visible: true, zIndex: 0 };
  if (track.targetKind === 'attachment') {
    const target = pose.attachments[track.targetId] ?? { ...defaults };
    if (track.property === 'visible') target.visible = Boolean(value);
    else target[track.property] = Number(value);
    pose.attachments[track.targetId] = target;
    pose.visibility[track.targetId] = target.visible;
    return;
  }
  const target = pose.transforms[track.targetId] ?? { x: 0, y: 0, rotation: 0, visible: true };
  if (track.property === 'visible') target.visible = Boolean(value);
  else target[track.property] = Number(value);
  pose.transforms[track.targetId] = target;
  pose.visibility[track.targetId] = target.visible;
}

export function normalizeClipFrame(clip: MotionClip, frame: number): number {
  const at = frameIndex(frame);
  if (!clip.loop) return clamp(at, 0, Math.max(0, clip.durationFrames - 1));
  const start = clamp(frameIndex(clip.loopStart), 0, Math.max(0, clip.durationFrames - 1));
  const end = clamp(frameIndex(clip.loopEnd), start, Math.max(start, clip.durationFrames - 1));
  if (at <= end && at >= start) return at;
  const length = end - start + 1;
  return start + (((at - start) % length) + length) % length;
}

export function evaluateClip(clip: MotionClip, rest: RestPose, frame: number, draft: DraftPose = {}): EvaluatedPose {
  const at = normalizeClipFrame(clip, frame);
  const pose: EvaluatedPose = {
    frame: at,
    joints: Object.fromEntries(rest.joints.map((joint) => [joint.id, { x: joint.restX, y: joint.restY }])),
    transforms: Object.fromEntries(Object.entries(rest.transforms ?? {}).map(([id, transform]) => [id, { ...transform }])),
    attachments: Object.fromEntries(Object.entries(rest.attachments ?? {}).map(([id, attachment]) => [id, { ...attachment }])),
    visibility: {},
  };
  for (const track of clip.tracks) {
    const value = evaluateTrack(track, at);
    if (value !== undefined) applyTrack(pose, track, value);
  }
  for (const [id, value] of Object.entries(draft.joints ?? {})) pose.joints[id] = { ...(pose.joints[id] ?? { x: 0, y: 0 }), ...value };
  for (const [id, value] of Object.entries(draft.transforms ?? {})) pose.transforms[id] = { ...(pose.transforms[id] ?? { x: 0, y: 0, rotation: 0, visible: true }), ...value };
  for (const [id, value] of Object.entries(draft.attachments ?? {})) pose.attachments[id] = { ...(pose.attachments[id] ?? { x: 0, y: 0, rotation: 0, visible: true, zIndex: 0 }), ...value };
  for (const joint of Object.values(pose.joints)) { joint.x = Math.round(joint.x); joint.y = Math.round(joint.y); }
  for (const transform of Object.values(pose.transforms)) { transform.x = Math.round(transform.x); transform.y = Math.round(transform.y); transform.rotation = Math.round(transform.rotation); if (transform.zIndex !== undefined) transform.zIndex = Math.round(transform.zIndex); }
  for (const attachment of Object.values(pose.attachments)) { attachment.x = Math.round(attachment.x); attachment.y = Math.round(attachment.y); attachment.rotation = Math.round(attachment.rotation); attachment.zIndex = Math.round(attachment.zIndex); }
  return pose;
}

function poseEntries(pose: CapturedPose): Array<{ kind: MotionTargetKind; id: string; property: MotionProperty; value: MotionValue }> {
  const entries: Array<{ kind: MotionTargetKind; id: string; property: MotionProperty; value: MotionValue }> = [];
  for (const [id, joint] of Object.entries(pose.joints ?? {})) { entries.push({ kind: 'joint', id, property: 'x', value: joint.x }, { kind: 'joint', id, property: 'y', value: joint.y }); }
  for (const [id, transform] of Object.entries(pose.transforms ?? {})) for (const property of ['x', 'y', 'rotation', 'visible', 'zIndex'] as const) if (transform[property] !== undefined) entries.push({ kind: 'segment', id, property, value: transform[property] as MotionValue });
  for (const [id, attachment] of Object.entries(pose.attachments ?? {})) for (const property of ['x', 'y', 'rotation', 'visible', 'zIndex'] as const) entries.push({ kind: 'attachment', id, property, value: attachment[property] });
  return entries;
}

export function capturePoseAsKeyframes(clip: MotionClip, frame: number, pose: CapturedPose, interpolation: MotionInterpolation = 'linear'): MotionClip {
  let tracks = [...clip.tracks];
  for (const entry of poseEntries(pose)) {
    const id = trackId(entry.kind, entry.id, entry.property);
    const index = tracks.findIndex((track) => track.targetKind === entry.kind && track.targetId === entry.id && track.property === entry.property);
    const track: MotionTrack = index >= 0 ? tracks[index] : { id, targetKind: entry.kind, targetId: entry.id, property: entry.property, keyframes: [] };
    const updated = upsertKeyframe(track, { frame, value: entry.value, interpolation });
    if (index >= 0) tracks = tracks.map((item, itemIndex) => itemIndex === index ? updated : item);
    else tracks.push(updated);
  }
  return { ...clip, tracks };
}
