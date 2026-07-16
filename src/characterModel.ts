import type { CharacterRig, RigBone, RigJoint } from './rig';
import type { Segment, SegmentTransform } from './segmentation';

export type MaterialSlot = 'skin' | 'hair' | 'shirt' | 'jacket' | 'pants' | 'metal' | 'leather' | 'emissive' | 'unassigned';
export type AttachmentKind = 'hair-front' | 'hair-back' | 'horns-ears' | 'headwear' | 'face' | 'chest' | 'back' | 'shoulder' | 'hand' | 'cape-tail' | 'weapon-primary' | 'weapon-secondary';
export type SemanticPart = Segment & { materialSlot: MaterialSlot; parentJointId?: string };
export type AttachmentSlot = { id: string; name: string; kind: AttachmentKind; parentJointId: string; anchor: { x: number; y: number }; zIndex: number; secondaryJointIds: string[]; visible: boolean };
export type Skeleton = { joints: RigJoint[]; bones: RigBone[]; approved: boolean };
export type SemanticModel = { id: string; name: string; source: string; width: number; height: number; opaquePixelCount: number; parts: SemanticPart[]; skeleton: Skeleton; attachments: AttachmentSlot[]; pivot: { x: number; y: number }; baseline: number; approved: boolean };
export type MotionFrame = { frameIndex: number; duration: number; jointPositions: Record<string, { x: number; y: number }>; partTransforms: Record<string, SegmentTransform>; attachmentTransforms: Record<string, SegmentTransform> };
export type MotionClip = { id: string; name: string; loopMode: 'loop' | 'once' | 'ping-pong'; frames: MotionFrame[] };
export type RenderRecipe = { palette: string[]; outlineColors: string[]; outlineWidth: number; lightDirection: 'top-left' | 'top' | 'top-right'; shadingBands: number; clusterScale: number; facialRules: string; mustPreserve: string; materials: Record<MaterialSlot, string[]> };
export type SkinReference = { id: string; name: string; src: string };
export type PlayerSkin = { id: string; name: string; references: SkinReference[]; recipe: RenderRecipe; attachments: Partial<Record<AttachmentKind, string>>; provenance: { provider: 'local' | 'cloud' | 'manual'; createdAt: string }; approved: boolean };
export type RenderedVariant = { id: string; skinId: string; modelId: string; clipId: string; frameSources: string[]; frameDurations: number[]; createdAt: string; approved: boolean };
export type ValidationFinding = { id: string; severity: 'error' | 'warning' | 'info'; scope: 'model' | 'rig' | 'skin' | 'frame' | 'export'; message: string; partId?: string; frameIndex?: number; repair?: 'assign' | 'ground' | 'align' | 'palette' | 'attachment' };

export const materialForName = (name: string): MaterialSlot => {
  const value = name.toLowerCase();
  if (value.includes('head') || value.includes('hand')) return 'skin';
  if (value.includes('hair')) return 'hair';
  if (value.includes('leg') || value.includes('pants')) return 'pants';
  if (value.includes('arm') || value.includes('torso')) return 'jacket';
  return 'unassigned';
};

export function semanticParts(segments: Segment[], rig: CharacterRig): SemanticPart[] {
  return segments.map((segment) => ({
    ...segment,
    materialSlot: segment.materialSlot || materialForName(segment.name),
    parentJointId: segment.parentJointId || rig.bones.find((bone) => bone.segmentId === segment.id)?.parentJointId,
  }));
}

export function defaultAttachments(rig: CharacterRig, width: number, height: number): AttachmentSlot[] {
  const joint = (id: string, fallback: { x: number; y: number }) => rig.joints.find((item) => item.id === id) || fallback;
  const head = joint('head', { x: width / 2, y: height / 4 });
  const chest = joint('chest', { x: width / 2, y: height / 2 });
  const hand = joint('hand-r', { x: width * .78, y: height * .7 });
  return [
    ['hair-front', 'Front hair', 'hair-front', 'head', head, 100], ['hair-back', 'Back hair', 'hair-back', 'head', head, -10],
    ['headwear', 'Headwear', 'headwear', 'head', head, 110], ['face', 'Face details', 'face', 'head', head, 105],
    ['chest-equipment', 'Chest equipment', 'chest', 'chest', chest, 60], ['back-equipment', 'Back equipment', 'back', 'chest', chest, -20],
    ['primary-weapon', 'Primary weapon', 'weapon-primary', 'hand-r', hand, 120], ['cape-tail', 'Cape or tail', 'cape-tail', 'root', chest, -30],
  ].map(([id, name, kind, parentJointId, anchor, zIndex]) => ({ id, name, kind, parentJointId, anchor: { x: Math.round((anchor as { x: number }).x), y: Math.round((anchor as { y: number }).y) }, zIndex, secondaryJointIds: [], visible: true } as AttachmentSlot));
}

export function buildSemanticModel(name: string, source: string, width: number, height: number, segments: Segment[], rig: CharacterRig, pivot: { x: number; y: number }, opaquePixelCount = 0): SemanticModel {
  return { id: `model-${name}`, name, source, width, height, opaquePixelCount, parts: semanticParts(segments, rig), skeleton: { joints: rig.joints, bones: rig.bones, approved: rig.status === 'approved' }, attachments: defaultAttachments(rig, width, height), pivot, baseline: height - 1, approved: rig.status === 'approved' && segments.length > 0 };
}

export function validateSemanticModel(model: SemanticModel, opaquePixels?: number[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const owners = new Map<number, string[]>();
  for (const part of model.parts) for (const pixel of part.pixels) owners.set(pixel, [...(owners.get(pixel) || []), part.id]);
  for (const [pixel, partIds] of owners) if (partIds.length > 1) findings.push({ id: `overlap-${pixel}`, severity: 'error', scope: 'model', message: `Pixel ${pixel} belongs to multiple parts.`, partId: partIds[0], repair: 'assign' });
  if (model.opaquePixelCount > 0 && owners.size !== model.opaquePixelCount) findings.push({ id: 'coverage', severity: 'error', scope: 'model', message: `${Math.abs(model.opaquePixelCount - owners.size).toLocaleString()} opaque pixels are not assigned exactly once.`, repair: 'assign' });
  if (opaquePixels) for (const pixel of opaquePixels) if (!owners.has(pixel)) findings.push({ id: `unassigned-${pixel}`, severity: 'error', scope: 'model', message: 'Opaque model pixels remain unassigned.', repair: 'assign' });
  if (!model.parts.length) findings.push({ id: 'missing-parts', severity: 'error', scope: 'model', message: 'Analyze or create semantic parts before approving the model.' });
  for (const part of model.parts) {
    if (!part.pixels.length) findings.push({ id: `empty-${part.id}`, severity: 'warning', scope: 'model', message: `${part.name} has no pixels.`, partId: part.id });
    if (part.materialSlot === 'unassigned') findings.push({ id: `material-${part.id}`, severity: 'warning', scope: 'model', message: `${part.name} needs a material slot.`, partId: part.id });
    if (!part.parentJointId) findings.push({ id: `joint-${part.id}`, severity: 'warning', scope: 'rig', message: `${part.name} is not bound to a joint.`, partId: part.id });
  }
  return findings;
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
export async function extractRenderRecipe(references: SkinReference[]): Promise<RenderRecipe> {
  const counts = new Map<string, number>();
  for (const reference of references) {
    const image = await loadImage(reference.src); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let offset = 0; offset < data.length; offset += 4) if (data[offset + 3] > 127) { const color = `#${[data[offset], data[offset + 1], data[offset + 2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`; counts.set(color, (counts.get(color) || 0) + 1); }
  }
  const palette = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([color]) => color);
  const luminance = (hex: string) => { const rgb = hex.slice(1).match(/../g)?.map((value) => Number.parseInt(value, 16)) || [0, 0, 0]; return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
  const sorted = [...palette].sort((a, b) => luminance(a) - luminance(b));
  const darkest = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3))); const lightest = sorted.slice(-Math.max(1, Math.ceil(sorted.length / 3))); const middle = sorted.slice(Math.floor(sorted.length / 4), Math.max(Math.floor(sorted.length / 4) + 1, Math.ceil(sorted.length * .75)));
  const saturation = (hex: string) => { const rgb = hex.slice(1).match(/../g)!.map((value) => Number.parseInt(value, 16)); return Math.max(...rgb) - Math.min(...rgb); };
  return { palette, outlineColors: sorted.slice(0, Math.min(2, sorted.length)), outlineWidth: 1, lightDirection: 'top-left', shadingBands: 3, clusterScale: 1, facialRules: '', mustPreserve: '', materials: { skin: lightest, hair: darkest, shirt: middle, jacket: middle, pants: darkest, metal: lightest, leather: darkest, emissive: [...palette].sort((a, b) => saturation(b) - saturation(a)).slice(0, 3), unassigned: palette } };
}

export async function renderLockedSkin(model: SemanticModel, skin: PlayerSkin, source: string): Promise<string> {
  const image = await loadImage(source); const canvas = document.createElement('canvas'); canvas.width = model.width; canvas.height = model.height; const context = canvas.getContext('2d')!; context.imageSmoothingEnabled = false; context.drawImage(image, 0, 0, model.width, model.height); const data = context.getImageData(0, 0, model.width, model.height);
  const remapPixels = (pixels: number[], targetColors: string[]) => {
    if (!targetColors.length) targetColors = skin.recipe.palette; if (!targetColors.length) return;
    const histogram = new Map<string, number>(); for (const pixel of pixels) { const offset = pixel * 4; if (!data.data[offset + 3]) continue; const key = `${data.data[offset]},${data.data[offset + 1]},${data.data[offset + 2]}`; histogram.set(key, (histogram.get(key) || 0) + 1); }
    const sourceColors = [...histogram].sort((a, b) => b[1] - a[1]).map(([color]) => color); const rank = new Map(sourceColors.map((color, index) => [color, index])); const targets = targetColors.map((hex) => hex.slice(1).match(/../g)!.map((value) => Number.parseInt(value, 16)));
    for (const pixel of pixels) { const offset = pixel * 4; if (!data.data[offset + 3]) continue; const sourceRank = rank.get(`${data.data[offset]},${data.data[offset + 1]},${data.data[offset + 2]}`) || 0; const color = targets[Math.min(targets.length - 1, Math.floor(sourceRank * targets.length / Math.max(1, sourceColors.length)))]; data.data[offset] = color[0]; data.data[offset + 1] = color[1]; data.data[offset + 2] = color[2]; }
  };
  const assigned = new Set<number>(); for (const part of model.parts) { part.pixels.forEach((pixel) => assigned.add(pixel)); remapPixels(part.pixels, skin.recipe.materials[part.materialSlot] || skin.recipe.palette); }
  const remaining: number[] = []; for (let pixel = 0; pixel < model.width * model.height; pixel += 1) if (!assigned.has(pixel) && data.data[pixel * 4 + 3]) remaining.push(pixel); remapPixels(remaining, skin.recipe.materials.unassigned || skin.recipe.palette);
  context.putImageData(data, 0, 0); return canvas.toDataURL('image/png');
}
