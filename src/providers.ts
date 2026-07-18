import { analyzeSpriteLocally, type CompletedRigLayer, type PoseSuggestion, type RigAnalysisSuggestion, type RigBone, type RigJoint, type RigLayer, type PoseKeyframe } from './rig';

export type CycleGenerationRequest = {
  source: string;
  width: number;
  height: number;
  palette: string[];
  cycle: { id: string; frames: number; timing: number };
  pivot: { x: number; y: number };
  identity?: { features: string; expression: string; preserve: string };
  segments?: { id: string; name: string; description: string; pixels: number[]; pivot: { x: number; y: number }; zIndex: number; locked: boolean; visible: boolean }[];
  segmentTransforms?: Record<string, { x: number; y: number; rotation: number; visible: boolean; zIndex?: number }>;
  references?: { id: string; name: string; src: string }[];
  prompt?: string;
  preserveShape?: boolean;
};

export type RigAnalysisRequest = { source: string; width: number; height: number; palette: string[]; identity?: CycleGenerationRequest['identity']; segments?: CycleGenerationRequest['segments'] };
export type LayerCompletionTarget = RigLayer & { candidatePixels?: number[]; occluderNames?: string[] };
export type LayerCompletionRequest = RigAnalysisRequest & { layers: LayerCompletionTarget[] };
export type PoseSuggestionRequest = RigAnalysisRequest & { description: string; joints: RigJoint[]; bones: RigBone[] };
export type InbetweenGenerationRequest = CycleGenerationRequest & { keyframes: PoseKeyframe[]; guideFrames: GeneratedFrame[]; layers: RigLayer[]; joints: RigJoint[]; bones: RigBone[] };

export type GeneratedFrame = { src: string; duration: number };
export type GeneratedCycle = { frames: GeneratedFrame[]; sheet?: string; sheetColumns?: number };
export type FrameRegenerationRequest = CycleGenerationRequest & { frameIndexes: number[]; notes?: string };
export type ProviderStatus = { available: boolean; label: string; detail?: string };

export interface SpriteGenerationProvider {
  generateCycle(request: CycleGenerationRequest): Promise<GeneratedCycle>;
  regenerateFrames(request: FrameRegenerationRequest): Promise<GeneratedFrame[]>;
  getStatus(): Promise<ProviderStatus>;
  analyzeRig(request: RigAnalysisRequest): Promise<RigAnalysisSuggestion>;
  completeRigLayers(request: LayerCompletionRequest): Promise<CompletedRigLayer[]>;
  suggestPose(request: PoseSuggestionRequest): Promise<PoseSuggestion>;
  generateInbetweens(request: InbetweenGenerationRequest): Promise<GeneratedFrame[]>;
}

/** Development provider: lets the complete UX run without a model service. */
export class MockSpriteGenerationProvider implements SpriteGenerationProvider {
  async generateCycle(request: CycleGenerationRequest): Promise<GeneratedCycle> {
    return { frames: Array.from({ length: request.cycle.frames }, () => ({ src: request.source, duration: request.cycle.timing })) };
  }
  async regenerateFrames(request: FrameRegenerationRequest): Promise<GeneratedFrame[]> {
    return request.frameIndexes.map(() => ({ src: request.source, duration: request.cycle.timing }));
  }
  async getStatus(): Promise<ProviderStatus> { return { available: true, label: 'Preview only', detail: 'Repeats the source sprite without model generation' }; }
  async analyzeRig(request: RigAnalysisRequest): Promise<RigAnalysisSuggestion> { return analyzeSpriteLocally(request.source, request.width, request.height); }
  async completeRigLayers(request: LayerCompletionRequest): Promise<CompletedRigLayer[]> { return request.layers.map((layer) => ({ layerId: layer.id, completedSrc: layer.completedSrc, generatedPixels: layer.generatedPixels || [], confidence: layer.completedSrc ? .7 : 1 })); }
  async suggestPose(request: PoseSuggestionRequest): Promise<PoseSuggestion> { const joints = Object.fromEntries(request.joints.map((joint) => [joint.id, { x: joint.x, y: joint.y }])); const wave = request.description.toLowerCase().includes('wav'); if (wave && joints['hand-r']) joints['hand-r'] = { x: request.width * .82, y: request.height * .28 }; return { joints, transforms: {} }; }
  async generateInbetweens(request: InbetweenGenerationRequest): Promise<GeneratedFrame[]> { return request.guideFrames; }
}

/** Adapter for a future local model service. The app never owns model-specific request shapes. */
export class LocalModelProvider implements SpriteGenerationProvider {
  constructor(private readonly endpoint = 'http://127.0.0.1:8787') {}
  async getStatus(): Promise<ProviderStatus> {
    try { const response = await fetch(`${this.endpoint}/health`); return { available: response.ok, label: 'Local model', detail: response.ok ? 'Connected' : 'Unavailable' }; }
    catch { return { available: false, label: 'Local model', detail: 'Start your local generation service to connect' }; }
  }
  async generateCycle(request: CycleGenerationRequest): Promise<GeneratedCycle> { return this.post('/generate-cycle', request); }
  async regenerateFrames(request: FrameRegenerationRequest): Promise<GeneratedFrame[]> { return (await this.post('/regenerate-frames', request)).frames; }
  async analyzeRig(request: RigAnalysisRequest): Promise<RigAnalysisSuggestion> { const local = await analyzeSpriteLocally(request.source, request.width, request.height); try { const remote = await this.postJson<Partial<RigAnalysisSuggestion>>('/analyze-rig', request); const bones = remote.bones?.length ? remote.bones.map((bone) => ({ ...bone, segmentId: bone.segmentId || local.bones.find((item) => item.id === bone.id)?.segmentId })) : local.bones; return { segments: local.segments, joints: remote.joints?.length ? remote.joints : local.joints, bones }; } catch { return local; } }
  async completeRigLayers(request: LayerCompletionRequest): Promise<CompletedRigLayer[]> { return this.postJson('/complete-rig-layers', request); }
  async suggestPose(request: PoseSuggestionRequest): Promise<PoseSuggestion> { return this.postJson('/suggest-pose', request); }
  async generateInbetweens(request: InbetweenGenerationRequest): Promise<GeneratedFrame[]> { return (await this.post('/generate-inbetweens', request)).frames; }
  private async postJson<T>(path: string, body: unknown): Promise<T> { const response = await fetch(`${this.endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(await response.text() || `Local model request failed (${response.status})`); return response.json() as Promise<T>; }
  private async post(path: string, body: unknown): Promise<GeneratedCycle> { const response = await fetch(`${this.endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) { const detail = await response.text(); throw new Error(detail || `Local model request failed (${response.status})`); } return response.json() as Promise<GeneratedCycle>; }
}

export class CloudModelProvider implements SpriteGenerationProvider {
  constructor(private readonly endpoint = 'http://127.0.0.1:8787') {}
  async getStatus(): Promise<ProviderStatus> { try { const response = await fetch(`${this.endpoint}/openai/health`); return { available: response.ok, label: 'Cloud model', detail: response.ok ? 'OpenAI key configured' : 'OPENAI_API_KEY not configured' }; } catch { return { available: false, label: 'Cloud model', detail: 'Start the local bridge' }; } }
  async generateCycle(request: CycleGenerationRequest): Promise<GeneratedCycle> { return this.post('/openai/generate-cycle', request); }
  async regenerateFrames(request: FrameRegenerationRequest): Promise<GeneratedFrame[]> { return (await this.post('/openai/regenerate-frames', request)).frames; }
  async analyzeRig(request: RigAnalysisRequest): Promise<RigAnalysisSuggestion> { const local = await analyzeSpriteLocally(request.source, request.width, request.height); try { const remote = await this.postJson<Partial<RigAnalysisSuggestion>>('/openai/analyze-rig', request); const bones = remote.bones?.length ? remote.bones.map((bone) => ({ ...bone, segmentId: bone.segmentId || local.bones.find((item) => item.id === bone.id)?.segmentId })) : local.bones; return { segments: local.segments, joints: remote.joints?.length ? remote.joints : local.joints, bones }; } catch { return local; } }
  async completeRigLayers(request: LayerCompletionRequest): Promise<CompletedRigLayer[]> { return this.postJson('/openai/complete-rig-layers', request); }
  async suggestPose(request: PoseSuggestionRequest): Promise<PoseSuggestion> { return this.postJson('/openai/suggest-pose', request); }
  async generateInbetweens(request: InbetweenGenerationRequest): Promise<GeneratedFrame[]> { return (await this.post('/openai/generate-inbetweens', request)).frames; }
  private async postJson<T>(path: string, body: unknown): Promise<T> { const response = await fetch(`${this.endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) }); if (!response.ok) throw new Error(await response.text() || `Cloud model request failed (${response.status})`); return response.json() as Promise<T>; }
  private async post(path: string, body: unknown): Promise<GeneratedCycle> { const request = body as CycleGenerationRequest & { frameIndexes?: number[] }; const startedAt = performance.now(); console.info('[pixelmate] cloud request started', { path, cycle: request.cycle.id, frames: request.frameIndexes?.length ?? request.cycle.frames }); try { const response = await fetch(`${this.endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) }); console.info('[pixelmate] bridge response received', { path, status: response.status, elapsedMs: Math.round(performance.now() - startedAt) }); if (!response.ok) { const detail = await response.text(); throw new Error(detail || 'Cloud model request failed'); } const result = await response.json() as GeneratedCycle; console.info('[pixelmate] cloud request completed', { path, frames: result.frames?.length ?? 0, elapsedMs: Math.round(performance.now() - startedAt) }); return result; } catch (error) { console.error('[pixelmate] cloud request failed', { path, elapsedMs: Math.round(performance.now() - startedAt), error }); throw error; } }
}
