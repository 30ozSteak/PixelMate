export type SegmentTransform = { x: number; y: number; rotation: number; visible: boolean; zIndex?: number };
export type Segment = { id: string; name: string; description: string; color: string; pixels: number[]; pivot: { x: number; y: number }; zIndex: number; locked: boolean; visible: boolean; materialSlot?: import('./characterModel').MaterialSlot; parentJointId?: string };

export const defaultSegmentColors = ['#a78bfa', '#31c48d', '#f59e0b', '#60a5fa', '#f472b6', '#fb7185', '#22d3ee', '#f97316'];
export const neutralTransform = (): SegmentTransform => ({ x: 0, y: 0, rotation: 0, visible: true });
export const pixelSet = (pixels: number[]) => new Set(pixels);

export function assignPixels(segments: Segment[], segmentId: string, pixels: number[], mode: 'paint' | 'erase'): Segment[] {
  const target = new Set(pixels);
  return segments.map((segment) => {
    if (segment.id === segmentId && mode === 'paint') return { ...segment, pixels: [...new Set([...segment.pixels, ...pixels])] };
    if (mode === 'paint' || segment.id === segmentId) return { ...segment, pixels: segment.pixels.filter((pixel) => !target.has(pixel)) };
    return segment;
  });
}

export function contiguousOpaqueRegion(alpha: Uint8ClampedArray, width: number, height: number, start: number): number[] {
  if (!alpha[start * 4 + 3]) return [];
  const visited = new Uint8Array(width * height); const result: number[] = []; const queue = [start];
  while (queue.length) {
    const pixel = queue.pop()!;
    if (visited[pixel] || !alpha[pixel * 4 + 3]) continue;
    visited[pixel] = 1; result.push(pixel);
    const x = pixel % width; const y = Math.floor(pixel / width);
    if (x > 0) queue.push(pixel - 1); if (x < width - 1) queue.push(pixel + 1); if (y > 0) queue.push(pixel - width); if (y < height - 1) queue.push(pixel + width);
  }
  return result;
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });

export async function composeRig(source: string, width: number, height: number, segments: Segment[], transforms: Record<string, SegmentTransform> = {}, completedLayers: Record<string, string> = {}): Promise<string> {
  const image = await loadImage(source); const base = document.createElement('canvas'); base.width = width; base.height = height; const baseCtx = base.getContext('2d')!; baseCtx.imageSmoothingEnabled = false; baseCtx.drawImage(image, 0, 0, width, height); const pixels = baseCtx.getImageData(0, 0, width, height);
  const composed = document.createElement('canvas'); composed.width = width; composed.height = height; const ctx = composed.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  const assigned = new Set(segments.flatMap((segment) => segment.pixels)); const unassigned = ctx.createImageData(width, height);
  for (let pixel = 0; pixel < width * height; pixel += 1) if (!assigned.has(pixel)) { const offset = pixel * 4; unassigned.data.set(pixels.data.slice(offset, offset + 4), offset); }
  ctx.putImageData(unassigned, 0, 0);
  const ordered = [...segments].sort((a, b) => (transforms[a.id]?.zIndex ?? a.zIndex ?? 0) - (transforms[b.id]?.zIndex ?? b.zIndex ?? 0));
  for (const segment of ordered) {
    const transform = transforms[segment.id] || neutralTransform(); if (segment.visible === false || transform.visible === false) continue;
    const layer = document.createElement('canvas'); layer.width = width; layer.height = height; const layerCtx = layer.getContext('2d')!; layerCtx.imageSmoothingEnabled = false;
    if (completedLayers[segment.id]) layerCtx.drawImage(await loadImage(completedLayers[segment.id]), 0, 0, width, height);
    else { const layerData = layerCtx.createImageData(width, height); for (const pixel of segment.pixels) { const offset = pixel * 4; layerData.data.set(pixels.data.slice(offset, offset + 4), offset); } layerCtx.putImageData(layerData, 0, 0); }
    const pivot = segment.pivot || { x: 0, y: 0 }; ctx.save(); ctx.translate(pivot.x + transform.x, pivot.y + transform.y); ctx.rotate((transform.rotation * Math.PI) / 180); ctx.translate(-pivot.x, -pivot.y); ctx.drawImage(layer, 0, 0); ctx.restore();
  }
  return composed.toDataURL('image/png');
}
