export type LayerCompletionSegment = { id: string; pixels: number[]; zIndex: number };
export type LayerCompletionLayer = { segmentId: string; visiblePixels: number[] };

function distanceFromPixels(width: number, height: number, pixels: number[]): Int32Array {
  const total = width * height;
  const distance = new Int32Array(total);
  distance.fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (const pixel of pixels) {
    if (pixel < 0 || pixel >= total || distance[pixel] !== -1) continue;
    distance[pixel] = 0;
    queue[tail++] = pixel;
  }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const neighbors = [pixel - width, pixel + width, x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1];
    for (const next of neighbors) {
      if (next < 0 || next >= total || distance[next] !== -1) continue;
      distance[next] = distance[pixel] + 1;
      queue[tail++] = next;
    }
  }
  return distance;
}

/** Pixels where a foreground segment may be hiding this layer in the rest pose. */
export function hiddenPixelCandidates(layer: LayerCompletionLayer, segments: LayerCompletionSegment[], width: number, height: number): number[] {
  if (!layer.visiblePixels.length || width <= 0 || height <= 0) return [];
  const target = segments.find((segment) => segment.id === layer.segmentId);
  if (!target) return [];
  const distance = distanceFromPixels(width, height, layer.visiblePixels);
  const maxDepth = Math.max(2, Math.min(12, Math.round(Math.min(width, height) * .04)));
  const compactLimit = Math.max(24, Math.round(layer.visiblePixels.length * .35));
  const targetXs = layer.visiblePixels.map((pixel) => pixel % width);
  const targetYs = layer.visiblePixels.map((pixel) => Math.floor(pixel / width));
  const targetBounds = { minX: Math.min(...targetXs), maxX: Math.max(...targetXs), minY: Math.min(...targetYs), maxY: Math.max(...targetYs) };
  const candidates = new Set<number>();
  for (const occluder of segments) {
    if (occluder.id === target.id || occluder.zIndex <= target.zIndex || !occluder.pixels.length) continue;
    const touchesLayer = occluder.pixels.some((pixel) => distance[pixel] >= 0 && distance[pixel] <= 2);
    if (!touchesLayer) continue;
    const enclosedPixels = occluder.pixels.filter((pixel) => { const x = pixel % width; const y = Math.floor(pixel / width); return x >= targetBounds.minX && x <= targetBounds.maxX && y >= targetBounds.minY && y <= targetBounds.maxY; }).length;
    const compactOccluder = occluder.pixels.length <= compactLimit && enclosedPixels / occluder.pixels.length >= .8;
    for (const pixel of occluder.pixels) if (compactOccluder || distance[pixel] <= maxDepth) candidates.add(pixel);
  }
  return [...candidates].sort((a, b) => a - b);
}
