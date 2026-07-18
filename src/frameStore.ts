import type { SegmentTransform } from './segmentation';

export type FrameProvenance = 'source' | 'authored' | 'deterministic' | 'generated' | 'refined';
export type RenderedFrame = {
  id: number;
  src: string;
  duration: number;
  flagged?: boolean;
  segmentTransforms?: Record<string, SegmentTransform>;
  provenance: FrameProvenance;
};

export type ClipFrameStore = Record<string, RenderedFrame[]>;

export const framesForClip = (store: ClipFrameStore, clipId: string): RenderedFrame[] => store[clipId] || [];

export function setFramesForClip(store: ClipFrameStore, clipId: string, frames: RenderedFrame[]): ClipFrameStore {
  return { ...store, [clipId]: frames };
}

export function updateFrameForClip(store: ClipFrameStore, clipId: string, frameIndex: number, patch: Partial<RenderedFrame>): ClipFrameStore {
  return setFramesForClip(store, clipId, framesForClip(store, clipId).map((frame, index) => index === frameIndex ? { ...frame, ...patch } : frame));
}

export function resetClipFrames(clipId: string, source: string, duration = 180): ClipFrameStore {
  return { [clipId]: [{ id: Date.now(), src: source, duration, provenance: 'source' }] };
}
