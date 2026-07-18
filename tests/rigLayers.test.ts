import assert from 'node:assert/strict';
import test from 'node:test';
import { hiddenPixelCandidates } from '../src/layerCompletion.ts';
import type { Segment } from '../src/segmentation.ts';

const makeSegment = (id: string, pixels: number[], zIndex: number): Segment => ({
  id,
  name: id,
  description: '',
  color: '#ffffff',
  pixels,
  pivot: { x: 0, y: 0 },
  zIndex,
  locked: false,
  visible: true,
});

test('a compact foreground feature becomes a full hidden-pixel candidate region', () => {
  const width = 7;
  const eye = [16, 17, 18, 23, 24, 25];
  const head = Array.from({ length: 35 }, (_, index) => index + 7).filter((pixel) => !eye.includes(pixel));
  const segments = [makeSegment('head', head, 0), makeSegment('eyes', eye, 1)];
  const layer = { segmentId: 'head', visiblePixels: head };

  assert.deepEqual(hiddenPixelCandidates(layer, segments, width, 7), eye);
});

test('distant and background segments are not treated as occluders', () => {
  const segments = [
    makeSegment('head', [0, 1, 5, 6], 1),
    makeSegment('behind', [2, 3], 0),
    makeSegment('distant', [34], 2),
  ];
  const layer = { segmentId: 'head', visiblePixels: segments[0].pixels };

  assert.deepEqual(hiddenPixelCandidates(layer, segments, 7, 5), []);
});

test('a touching appendage receives only a shallow seam fill', () => {
  const width = 12;
  const body = [14, 15, 16, 17, 26, 27, 28, 29, 38, 39, 40, 41];
  const arm = [30, 31, 32, 33, 34, 35];
  const segments = [makeSegment('body', body, 0), makeSegment('arm', arm, 1)];

  assert.deepEqual(hiddenPixelCandidates({ segmentId: 'body', visiblePixels: body }, segments, width, 5), [30, 31]);
});
