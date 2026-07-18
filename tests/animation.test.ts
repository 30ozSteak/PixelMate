import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePoseAsKeyframes, evaluateClip, evaluateTrack, moveKeyframes, shortestRotationDelta, type MotionClip, type MotionTrack } from '../src/animation.ts';
import { legacyCycleToClip, validateMotionTargets } from '../src/projectV5.ts';

const track = (property: MotionTrack['property'], values: Array<[number, number]>): MotionTrack => ({ id: `segment:arm:${property}`, targetKind: 'segment', targetId: 'arm', property, keyframes: values.map(([frame, value]) => ({ id: `${property}-${frame}`, frame, value, interpolation: 'linear' })) });

test('interpolates numeric tracks and rotations deterministically', () => {
  assert.equal(evaluateTrack(track('x', [[0, 0], [4, 8]]), 2), 4);
  assert.equal(shortestRotationDelta(350, 10), 20);
  assert.equal(evaluateTrack(track('rotation', [[0, 350], [2, 10]]), 1), 360);
});

test('stepped visibility holds until the next key', () => {
  const visibility: MotionTrack = { id: 'segment:arm:visible', targetKind: 'segment', targetId: 'arm', property: 'visible', keyframes: [{ id: 'a', frame: 0, value: true, interpolation: 'stepped' }, { id: 'b', frame: 3, value: false, interpolation: 'stepped' }] };
  assert.equal(evaluateTrack(visibility, 2), true);
  assert.equal(evaluateTrack(visibility, 3), false);
});

test('retiming resolves frame collisions in favor of moved keys', () => {
  const moved = moveKeyframes(track('x', [[0, 0], [2, 2], [4, 4]]), ['x-2'], 2);
  assert.deepEqual(moved.keyframes.map((key) => [key.frame, key.value]), [[0, 0], [4, 2]]);
});

test('captured poses become sparse tracks and evaluate on integer pixels', () => {
  const clip: MotionClip = { ...legacyCycleToClip({ id: 'idle', name: 'Idle', frames: 4, timing: 100 }), tracks: [] };
  const keyed = capturePoseAsKeyframes(clip, 1, { joints: { hand: { x: 3.6, y: 7.2 } }, transforms: { arm: { x: 1.4, y: 0, rotation: 12.6, visible: true } } });
  const pose = evaluateClip(keyed, { joints: [{ id: 'hand', restX: 0, restY: 0 }] }, 1);
  assert.deepEqual(pose.joints.hand, { x: 4, y: 7 });
  assert.deepEqual(pose.transforms.arm, { x: 1, y: 0, rotation: 13, visible: true });
});

test('target validation reports recoverable orphan tracks', () => {
  const clip = { ...legacyCycleToClip({ id: 'idle', name: 'Idle', frames: 4, timing: 100 }), tracks: [track('x', [[0, 0]])] };
  const result = validateMotionTargets([clip], { joints: [], segments: [], attachments: [] });
  assert.equal(result.orphanedTracks.length, 1);
  assert.equal(result.validClips[0].tracks.length, 0);
});
