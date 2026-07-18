import assert from 'node:assert/strict';
import test from 'node:test';
import { framesForClip, setFramesForClip, updateFrameForClip, type RenderedFrame } from '../src/frameStore.ts';
import { legacyCycleToClip, migrateLegacyMotion } from '../src/projectV5.ts';

const frame = (id: number, provenance: RenderedFrame['provenance'] = 'deterministic'): RenderedFrame => ({ id, src: `data:image/png;base64,${id}`, duration: 100, provenance });

test('clip-owned frames never overwrite another motion', () => {
  const store = setFramesForClip(setFramesForClip({}, 'idle', [frame(1)]), 'walk', [frame(2)]);
  const updated = updateFrameForClip(store, 'walk', 0, { duration: 80, provenance: 'refined' });
  assert.deepEqual(framesForClip(updated, 'idle'), [frame(1)]);
  assert.equal(framesForClip(updated, 'walk')[0].duration, 80);
  assert.equal(framesForClip(updated, 'walk')[0].provenance, 'refined');
});

test('legacy v4 frames and poses migrate into independent clips and variants', () => {
  const poses = [{ id: 'pose-a', cycleId: 'idle', frameIndex: 0, name: 'Start', description: '', joints: { root: { x: 1, y: 2 } }, transforms: {}, preview: 'data:image/png;base64,a', approved: true }];
  const migration = migrateLegacyMotion({ cycles: [{ id: 'idle', name: 'Idle', frames: 2, timing: 100, frameIds: [1, 2] }, { id: 'walk', name: 'Walk', frames: 2, timing: 80, frameIds: [3, 4] }], frames: [frame(1), frame(2), frame(3), frame(4)], poses, modelId: 'model' });
  assert.equal(migration.clips.length, 2);
  assert.equal(migration.clips[0].tracks.length, 2);
  assert.deepEqual(migration.renderedVariants.map((variant) => variant.clipId), ['idle', 'walk']);
  assert.deepEqual(migration.renderedVariants.map((variant) => variant.frameSources.length), [2, 2]);
});

test('new clips use integer frames and preserve loop metadata', () => {
  const clip = legacyCycleToClip({ id: 'attack', name: 'Attack', frames: 6, timing: 90, loopMode: 'once' });
  assert.equal(clip.durationFrames, 6);
  assert.equal(clip.loop, false);
  assert.equal(clip.loopEnd, 5);
});
