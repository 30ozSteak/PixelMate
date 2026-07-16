export type PixelSnapResult = { dataUrl: string; width: number; height: number; pixelSize: number; colorCount: number };

// Browser fallback with the same image-to-image contract as the vendored WASM module.
export async function snapPixelArt(source: string, requestedPixelSize = 4, colorCount = 16): Promise<PixelSnapResult> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = source; });
  const pixelSize = Math.max(1, Math.min(Math.floor(requestedPixelSize), Math.floor(Math.min(image.width, image.height) / 2) || 1));
  const width = Math.max(1, Math.ceil(image.width / pixelSize)); const height = Math.max(1, Math.ceil(image.height / pixelSize));
  const input = document.createElement('canvas'); input.width = image.width; input.height = image.height; const ictx = input.getContext('2d')!; ictx.drawImage(image, 0, 0); const pixels = ictx.getImageData(0, 0, image.width, image.height).data;
  const output = document.createElement('canvas'); output.width = width; output.height = height; const octx = output.getContext('2d')!; const result = octx.createImageData(width, height);
  for (let oy = 0; oy < height; oy++) for (let ox = 0; ox < width; ox++) { const counts = new Map<string, { count: number; rgba: [number, number, number, number] }>(); for (let y = oy * pixelSize; y < Math.min((oy + 1) * pixelSize, image.height); y++) for (let x = ox * pixelSize; x < Math.min((ox + 1) * pixelSize, image.width); x++) { const p = (y * image.width + x) * 4; const rgba: [number, number, number, number] = [pixels[p], pixels[p + 1], pixels[p + 2], pixels[p + 3]]; if (!rgba[3]) continue; const key = rgba.slice(0, 3).join(','); const entry = counts.get(key) ?? { count: 0, rgba }; entry.count++; counts.set(key, entry); } const winner = [...counts.values()].sort((a, b) => b.count - a.count)[0]?.rgba ?? [0, 0, 0, 0]; result.data.set(winner, (oy * width + ox) * 4); }
  const limit = Math.max(2, Math.min(64, Math.floor(colorCount)));
  const histogram = new Map<string, { count: number; rgb: [number, number, number] }>();
  for (let offset = 0; offset < result.data.length; offset += 4) {
    if (!result.data[offset + 3]) continue;
    const rgb: [number, number, number] = [result.data[offset], result.data[offset + 1], result.data[offset + 2]];
    const key = rgb.join(','); const entry = histogram.get(key) || { count: 0, rgb }; entry.count += 1; histogram.set(key, entry);
  }
  const palette = [...histogram.values()].sort((a, b) => b.count - a.count).slice(0, limit).map((entry) => entry.rgb);
  if (histogram.size > palette.length) for (let offset = 0; offset < result.data.length; offset += 4) {
    if (!result.data[offset + 3]) continue;
    const nearest = palette.reduce((best, color) => { const distance = Math.hypot(result.data[offset] - color[0], result.data[offset + 1] - color[1], result.data[offset + 2] - color[2]); return distance < best.distance ? { color, distance } : best; }, { color: palette[0], distance: Infinity });
    result.data[offset] = nearest.color[0]; result.data[offset + 1] = nearest.color[1]; result.data[offset + 2] = nearest.color[2];
  }
  octx.putImageData(result, 0, 0); return { dataUrl: output.toDataURL('image/png'), width, height, pixelSize, colorCount: palette.length };
}
