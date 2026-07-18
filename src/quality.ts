export type QualitySeverity = 'error' | 'warning';
export type QualityCode = 'dimensions' | 'alpha-leak' | 'palette-drift' | 'silhouette' | 'pivot' | 'baseline' | 'loop-seam';
export type QualityFinding = { code: QualityCode; severity: QualitySeverity; message: string; frameIndex?: number; value?: number; threshold?: number };
export type FramePixels = { width: number; height: number; data: Uint8ClampedArray };
export type FrameQualityOptions = { width: number; height: number; palette?: string[]; referenceAlpha?: ArrayLike<number>; silhouetteTolerance?: number; allowPartialAlpha?: boolean };
export type ClipFrameMetadata = { pivot: { x: number; y: number }; baseline: number };
export type ClipQualityOptions = { width: number; height: number; loop: boolean; metadata: ClipFrameMetadata[]; pivotTolerance?: number; baselineTolerance?: number; loopSeamTolerance?: number };

const colorKey = (r: number, g: number, b: number) => `${r},${g},${b}`;
const paletteKey = (hex: string) => {
  const value = hex.replace(/^#/, '');
  const expanded = value.length === 3 ? value.split('').map((part) => part + part).join('') : value.slice(0, 6);
  return colorKey(Number.parseInt(expanded.slice(0, 2), 16), Number.parseInt(expanded.slice(2, 4), 16), Number.parseInt(expanded.slice(4, 6), 16));
};
const isOpaque = (data: ArrayLike<number>, pixel: number) => data[pixel * 4 + 3] > 0;
const opaqueCount = (data: ArrayLike<number>) => { let count = 0; for (let pixel = 0; pixel < data.length / 4; pixel += 1) if (isOpaque(data, pixel)) count += 1; return count; };

export function validateFramePixels(frame: FramePixels, options: FrameQualityOptions, frameIndex?: number): QualityFinding[] {
  const findings: QualityFinding[] = [];
  if (frame.width !== options.width || frame.height !== options.height || frame.data.length !== frame.width * frame.height * 4) {
    findings.push({ code: 'dimensions', severity: 'error', frameIndex, message: `Expected ${options.width}x${options.height}; received ${frame.width}x${frame.height}.` });
    return findings;
  }
  const palette = new Set((options.palette ?? []).map(paletteKey));
  let alphaLeaks = 0;
  let partialAlpha = 0;
  const drift = new Set<string>();
  for (let pixel = 0; pixel < frame.width * frame.height; pixel += 1) {
    const offset = pixel * 4; const alpha = frame.data[offset + 3];
    if (alpha > 0 && alpha < 255) partialAlpha += 1;
    if (alpha > 0 && palette.size && !palette.has(colorKey(frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]))) drift.add(colorKey(frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]));
    if (options.referenceAlpha && alpha > 0 && options.referenceAlpha[offset + 3] === 0) alphaLeaks += 1;
  }
  if (partialAlpha && !options.allowPartialAlpha) findings.push({ code: 'alpha-leak', severity: 'error', frameIndex, value: partialAlpha, message: `${partialAlpha} pixels use partial alpha, which can create pixel-art edge leaks.` });
  if (alphaLeaks) findings.push({ code: 'alpha-leak', severity: 'warning', frameIndex, value: alphaLeaks, message: `${alphaLeaks} pixels extend outside the reference alpha mask.` });
  if (drift.size) findings.push({ code: 'palette-drift', severity: 'error', frameIndex, value: drift.size, message: `${drift.size} colors are outside the approved palette.` });
  if (options.referenceAlpha) {
    const expected = opaqueCount(options.referenceAlpha); const actual = opaqueCount(frame.data); const delta = expected ? Math.abs(actual - expected) / expected : actual ? 1 : 0; const tolerance = options.silhouetteTolerance ?? 0.2;
    if (delta > tolerance) findings.push({ code: 'silhouette', severity: 'warning', frameIndex, value: delta, threshold: tolerance, message: `Opaque silhouette area differs from the reference by ${Math.round(delta * 100)}%.` });
  }
  return findings;
}

export function alphaMaskDifference(left: FramePixels, right: FramePixels): number {
  if (left.width !== right.width || left.height !== right.height) return 1;
  let changed = 0; let union = 0;
  for (let pixel = 0; pixel < left.width * left.height; pixel += 1) { const a = isOpaque(left.data, pixel); const b = isOpaque(right.data, pixel); if (a || b) union += 1; if (a !== b) changed += 1; }
  return union ? changed / union : 0;
}

export function validateClipQuality(frames: FramePixels[], options: ClipQualityOptions): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const pivotTolerance = options.pivotTolerance ?? 1; const baselineTolerance = options.baselineTolerance ?? 1;
  for (let index = 0; index < options.metadata.length; index += 1) {
    const item = options.metadata[index];
    if (!item) continue;
    if (item.pivot.x < 0 || item.pivot.x >= options.width || item.pivot.y < 0 || item.pivot.y >= options.height) findings.push({ code: 'pivot', severity: 'error', frameIndex: index, message: 'Pivot is outside the frame.' });
    if (item.baseline < 0 || item.baseline >= options.height) findings.push({ code: 'baseline', severity: 'error', frameIndex: index, message: 'Baseline is outside the frame.' });
    if (index > 0) { const prior = options.metadata[index - 1]; if (prior && Math.hypot(item.pivot.x - prior.pivot.x, item.pivot.y - prior.pivot.y) > pivotTolerance) findings.push({ code: 'pivot', severity: 'warning', frameIndex: index, threshold: pivotTolerance, message: 'Pivot shifts more than the allowed per-frame tolerance.' }); if (prior && Math.abs(item.baseline - prior.baseline) > baselineTolerance) findings.push({ code: 'baseline', severity: 'warning', frameIndex: index, threshold: baselineTolerance, message: 'Baseline shifts more than the allowed per-frame tolerance.' }); }
  }
  if (options.loop && frames.length > 1) { const difference = alphaMaskDifference(frames[0], frames[frames.length - 1]); const tolerance = options.loopSeamTolerance ?? 0.1; if (difference > tolerance) findings.push({ code: 'loop-seam', severity: 'warning', value: difference, threshold: tolerance, message: `First and last silhouettes differ by ${Math.round(difference * 100)}%.` }); }
  return findings;
}

export async function decodeFrameSource(src: string): Promise<FramePixels> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = () => reject(new Error('Could not decode frame image.')); value.src = src; });
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 2D is unavailable.'); context.imageSmoothingEnabled = false; context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height); return { width: data.width, height: data.height, data: data.data };
}
