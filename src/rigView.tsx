import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eraser, Eye, EyeOff, Hand, LoaderCircle, Paintbrush, Plus, RotateCcw, Sparkles, Undo2, WandSparkles, ZoomIn, ZoomOut } from 'lucide-react';
import { assignPixels, defaultSegmentColors, neutralTransform, type Segment, type SegmentTransform } from './segmentation';
import { cloneHiddenLayer, jointMap, layersFromSegments, normalizeCompletedLayer, renderPose, solveTwoBoneIK, transformsFromJoints, type CharacterRig, type RigJoint, type RigLayer } from './rig';
import { hiddenPixelCandidates } from './layerCompletion';
import type { SpriteGenerationProvider } from './providers';
import { capturePoseAsKeyframes, evaluateClip, type MotionClip } from './animation';
import { TimelineEditor } from './timeline/TimelineEditor';

type Stage = 'analyze' | 'layers' | 'skeleton' | 'poses';
type Props = { source: string; width: number; height: number; palette: string[]; cycle: { id: string; name: string; frames: number; timing: number }; clip: MotionClip; segments: Segment[]; rig: CharacterRig; provider: SpriteGenerationProvider; busy: boolean; onSegmentsChange: (segments: Segment[]) => void; onRigChange: (rig: CharacterRig) => void; onClipChange: (clip: MotionClip) => void; onGenerateInbetweens: () => void; onContinue: () => void };

const stages: { id: Stage; label: string }[] = [{ id: 'analyze', label: '01 Analyze' }, { id: 'layers', label: '02 Layers' }, { id: 'skeleton', label: '03 Skeleton' }, { id: 'poses', label: '04 Poses' }];

function LayerPreview({ source, completedSrc, pixels, width, height }: { source: string; completedSrc?: string; pixels: number[]; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (completedSrc) return; const image = new Image(); image.onload = () => { const canvas = canvasRef.current; if (!canvas) return; canvas.width = width; canvas.height = height; const context = canvas.getContext('2d')!; context.imageSmoothingEnabled = false; context.drawImage(image, 0, 0, width, height); const sourceData = context.getImageData(0, 0, width, height); const output = context.createImageData(width, height); for (const pixel of pixels) { const offset = pixel * 4; output.data.set(sourceData.data.slice(offset, offset + 4), offset); } context.putImageData(output, 0, 0); }; image.src = source; }, [source, completedSrc, pixels, width, height]);
  return completedSrc ? <img src={completedSrc}/> : <canvas ref={canvasRef}/>;
}

export function RigView({ source, width, height, palette, cycle, clip, segments, rig, provider, busy, onSegmentsChange, onRigChange, onClipChange, onGenerateInbetweens, onContinue }: Props) {
  const [stage, setStage] = useState<Stage>(rig.status === 'empty' ? 'analyze' : 'skeleton'); const [activeId, setActiveId] = useState(segments[0]?.id || ''); const [brushSize, setBrushSize] = useState(4); const [maskTool, setMaskTool] = useState<'paint' | 'erase' | 'pan'>('paint'); const [maskZoom, setMaskZoom] = useState(1); const [maskPan, setMaskPan] = useState({ x: 0, y: 0 }); const [alpha, setAlpha] = useState<Uint8ClampedArray | null>(null); const [poseDescription, setPoseDescription] = useState(''); const [poseName, setPoseName] = useState('Key pose'); const [poseIndex, setPoseIndex] = useState(0); const [posedJoints, setPosedJoints] = useState<RigJoint[]>(rig.joints); const [timelineTransforms, setTimelineTransforms] = useState<Record<string, SegmentTransform>>({}); const [preview, setPreview] = useState(source); const [working, setWorking] = useState(''); const [skeletonZoom, setSkeletonZoom] = useState(1); const [skeletonPan, setSkeletonPan] = useState({ x: 0, y: 0 }); const [skeletonMoveMode, setSkeletonMoveMode] = useState(false); const [selectedJointId, setSelectedJointId] = useState(rig.joints[0]?.id || ''); const [hoveredJointId, setHoveredJointId] = useState<string | null>(null); const [previewZoom, setPreviewZoom] = useState(1); const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 }); const [previewMoveMode, setPreviewMoveMode] = useState(false); const maskCanvas = useRef<HTMLCanvasElement>(null); const skeletonCanvas = useRef<HTMLCanvasElement>(null); const imageRef = useRef<HTMLImageElement | null>(null); const dragJoint = useRef<string | null>(null); const panStart = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null); const skeletonPanStart = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null); const previewPanStart = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const maskHistory = useRef<Segment[][]>([]);
  const skeletonHistory = useRef<RigJoint[][]>([]);
    const jointListRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeSegment = segments.find((segment) => segment.id === activeId); const transforms = useMemo(() => transformsFromJoints(rig.joints, posedJoints, rig.bones), [rig.joints, rig.bones, posedJoints]); const previewTransforms = useMemo(() => ({ ...transforms, ...timelineTransforms }), [transforms, timelineTransforms]);

  useEffect(() => { const image = new Image(); image.onload = () => { imageRef.current = image; const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, width, height); setAlpha(ctx.getImageData(0, 0, width, height).data); }; image.src = source; }, [source, width, height]);
  useEffect(() => {
    if (!segments.length) {
      if (activeId) setActiveId('');
      return;
    }
    if (!segments.some((segment) => segment.id === activeId)) setActiveId(segments[0].id);
  }, [segments, activeId]);
  useEffect(() => { setPosedJoints(rig.joints); }, [rig.joints]);
  useEffect(() => { let cancelled = false; renderPose(source, width, height, segments, previewTransforms, rig.layers).then((src) => { if (!cancelled) setPreview(src); }); return () => { cancelled = true; }; }, [source, width, height, segments, previewTransforms, rig.layers]);
    useEffect(() => { jointListRefs.current[selectedJointId]?.scrollIntoView({ block: 'nearest' }); }, [selectedJointId]);
  useEffect(() => { const canvas = maskCanvas.current; const image = imageRef.current; if (!canvas || !image || !alpha) return; canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.drawImage(image, 0, 0, width, height); for (const segment of segments) { ctx.fillStyle = `${segment.color}${segment.id === activeId ? 'aa' : '55'}`; for (const pixel of segment.pixels) ctx.fillRect(pixel % width, Math.floor(pixel / width), 1, 1); } }, [segments, activeId, alpha, width, height]);
  useEffect(() => { 
    const canvas = skeletonCanvas.current; 
    const image = imageRef.current; 
    if (!canvas || !image || !alpha) return;
    canvas.width = width; 
    canvas.height = height; 
    const ctx = canvas.getContext('2d')!; 
    ctx.imageSmoothingEnabled = false; 
    ctx.drawImage(image, 0, 0, width, height); 
    ctx.lineWidth = Math.max(1, width / 100); 
    for (const bone of rig.bones) { 
      const a = posedJoints.find((joint) => joint.id === bone.parentJointId); 
      const b = posedJoints.find((joint) => joint.id === bone.childJointId); 
      if (!a || !b) continue; 
      ctx.strokeStyle = '#c4b5fd'; 
      ctx.beginPath(); 
      ctx.moveTo(a.x, a.y); 
      ctx.lineTo(b.x, b.y); 
      ctx.stroke(); 
    } 
    for (const joint of posedJoints) { 
      const isSelected = joint.id === selectedJointId;
      const isHovered = joint.id === hoveredJointId;
      const isDragging = joint.id === dragJoint.current;
      const baseRadius = Math.max(2, width / 80);
      
      if (isSelected) {
        ctx.fillStyle = '#ff6b9d';
        ctx.beginPath();
        ctx.arc(joint.x, joint.y, baseRadius * 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ff9ec3';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (isHovered) {
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.arc(joint.x, joint.y, baseRadius * 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (isDragging) {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(joint.x, joint.y, baseRadius * 1.3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(joint.x, joint.y, baseRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isSelected || isHovered || isDragging) {
        const label = joint.name;
        const fontSize = Math.max(10, Math.round(width / 32));
        ctx.font = `${fontSize}px 'DM Mono'`;
        ctx.textBaseline = 'middle';
        const textWidth = ctx.measureText(label).width;
        const paddingX = 6;
        const boxHeight = Math.max(16, Math.round(width / 20));
        const boxWidth = textWidth + paddingX * 2;
        const labelX = joint.x + baseRadius * 1.5 + 8;
        const labelY = joint.y - boxHeight - 8;
        ctx.fillStyle = 'rgba(16, 15, 22, 0.9)';
        ctx.strokeStyle = isSelected ? '#ff6b9d' : isHovered ? '#4ade80' : '#facc15';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const radius = 6;
        ctx.moveTo(labelX + radius, labelY);
        ctx.lineTo(labelX + boxWidth - radius, labelY);
        ctx.quadraticCurveTo(labelX + boxWidth, labelY, labelX + boxWidth, labelY + radius);
        ctx.lineTo(labelX + boxWidth, labelY + boxHeight - radius);
        ctx.quadraticCurveTo(labelX + boxWidth, labelY + boxHeight, labelX + boxWidth - radius, labelY + boxHeight);
        ctx.lineTo(labelX + radius, labelY + boxHeight);
        ctx.quadraticCurveTo(labelX, labelY + boxHeight, labelX, labelY + boxHeight - radius);
        ctx.lineTo(labelX, labelY + radius);
        ctx.quadraticCurveTo(labelX, labelY, labelX + radius, labelY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f3eff7';
        ctx.fillText(label, labelX + paddingX, labelY + boxHeight / 2);
      }
    } 
  }, [source, width, height, alpha, rig.bones, posedJoints, selectedJointId, hoveredJointId]);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => { 
    const target = event.currentTarget; 
    if (!target) return { x: 0, y: 0 }; 
    const rect = target.getBoundingClientRect(); 
    return { x: Math.round((event.clientX - rect.left) * width / rect.width), y: Math.round((event.clientY - rect.top) * height / rect.height) }; 
  };
  const cloneSegments = (items: Segment[]) => items.map((segment) => ({ ...segment, pixels: [...segment.pixels] }));
  const undoMaskEdit = () => {
    const previous = maskHistory.current.pop();
    if (!previous) return;
    onSegmentsChange(previous);
  };
  const paintMask = (event: React.PointerEvent<HTMLCanvasElement>) => { if (!alpha || !activeId || maskTool === 'pan') return; const point = canvasPoint(event); const min = -Math.floor((brushSize - 1) / 2); const max = Math.ceil((brushSize - 1) / 2); const pixels: number[] = []; for (let dy = min; dy <= max; dy++) for (let dx = min; dx <= max; dx++) { const x = point.x + dx; const y = point.y + dy; const pixel = y * width + x; if (x >= 0 && y >= 0 && x < width && y < height && alpha[pixel * 4 + 3]) pixels.push(pixel); } onSegmentsChange(assignPixels(segments, activeId, pixels, event.shiftKey || maskTool === 'erase' ? 'erase' : 'paint')); };
  const beginMaskInteraction = (event: React.PointerEvent<HTMLCanvasElement>) => { event.currentTarget.setPointerCapture(event.pointerId); if (maskTool === 'pan') { panStart.current = { x: event.clientX, y: event.clientY, originX: maskPan.x, originY: maskPan.y }; return; } maskHistory.current.push(cloneSegments(segments)); paintMask(event); };
  const moveMaskInteraction = (event: React.PointerEvent<HTMLCanvasElement>) => { if (maskTool === 'pan' && panStart.current) { setMaskPan({ x: panStart.current.originX + event.clientX - panStart.current.x, y: panStart.current.originY + event.clientY - panStart.current.y }); return; } if (event.buttons) paintMask(event); };
  const endMaskInteraction = () => { panStart.current = null; };
  const changeMaskZoom = (amount: number) => setMaskZoom((current) => Math.max(.5, Math.min(5, Math.round((current + amount) * 4) / 4)));
  const resetMaskView = () => { setMaskZoom(1); setMaskPan({ x: 0, y: 0 }); };
  const changePreviewZoom = (amount: number) => setPreviewZoom((current) => Math.max(.5, Math.min(4, Math.round((current + amount) * 4) / 4)));
  const resetPreviewView = () => { setPreviewZoom(1); setPreviewPan({ x: 0, y: 0 }); setPreviewMoveMode(false); };
  const beginPreviewInteraction = (event: React.PointerEvent<HTMLImageElement>) => { if (!previewMoveMode) return; event.currentTarget.setPointerCapture(event.pointerId); previewPanStart.current = { x: event.clientX, y: event.clientY, originX: previewPan.x, originY: previewPan.y }; };
  const movePreview = (event: React.PointerEvent<HTMLImageElement>) => { if (!previewMoveMode || !previewPanStart.current) return; setPreviewPan({ x: previewPanStart.current.originX + event.clientX - previewPanStart.current.x, y: previewPanStart.current.originY + event.clientY - previewPanStart.current.y }); };
  const endPreviewInteraction = () => { previewPanStart.current = null; };
  const analyze = async () => { setWorking('Analyzing anatomy…'); try { const result = await provider.analyzeRig({ source, width, height, palette, segments }); onSegmentsChange(result.segments); onRigChange({ status: 'suggested', joints: result.joints, bones: result.bones, layers: layersFromSegments(result.segments), poses: rig.poses }); setActiveId(result.segments[0]?.id || ''); } finally { setWorking(''); } };
  const candidatePixels = (layer: RigLayer) => hiddenPixelCandidates(layer, segments, width, height);
  const cloneLayer = async (layer: RigLayer): Promise<RigLayer> => {
    const candidates = candidatePixels(layer);
    if (!candidates.length) return { ...layer, completedSrc: undefined, generatedPixels: [], completionMode: undefined, approved: false };
    const cloned = await cloneHiddenLayer(source, width, height, layer, candidates);
    return { ...layer, ...cloned, completionMode: 'cloned', confidence: 1, approved: false };
  };
  const approveAnalysis = async () => {
    const initial = layersFromSegments(segments);
    setStage('layers');
    setWorking('Cloning pixels behind foreground segments…');
    try {
      const layers = await Promise.all(initial.map(cloneLayer));
      onRigChange({ ...rig, status: 'approved', layers });
    } finally {
      setWorking('');
    }
  };
  const completeLayers = async (layerIds?: string[]) => {
    const selected = rig.layers.filter((layer) => (!layerIds || layerIds.includes(layer.id)) && candidatePixels(layer).length);
    if (!selected.length) return;
    setWorking(layerIds ? 'Improving full layer…' : 'Improving hidden pixels…');
    try {
      const prepared = await Promise.all(selected.map((layer) => layer.completedSrc ? Promise.resolve(layer) : cloneLayer(layer)));
      const requestLayers = prepared.map((layer) => {
        const candidates = candidatePixels(layer);
        const candidateSet = new Set(candidates);
        const occluderNames = segments.filter((segment) => segment.id !== layer.segmentId && segment.pixels.some((pixel) => candidateSet.has(pixel))).map((segment) => segment.name);
        return { ...layer, candidatePixels: candidates, occluderNames };
      });
      const completed = await provider.completeRigLayers({ source, width, height, palette, segments, layers: requestLayers });
      const normalized = await Promise.all(rig.layers.map(async (layer) => {
        const base = prepared.find((item) => item.id === layer.id);
        if (!base) return layer;
        const result = completed.find((item) => item.layerId === layer.id);
        if (!result?.completedSrc || result.completedSrc === base.completedSrc) return { ...base, approved: false };
        const pixels = await normalizeCompletedLayer(source, result.completedSrc, width, height, palette, base.visiblePixels, candidatePixels(base));
        if (!pixels.generatedPixels.length) return { ...base, approved: false };
        return { ...base, ...result, ...pixels, completionMode: base.completionMode === 'generated' ? 'refined' as const : 'generated' as const, approved: false };
      }));
      onRigChange({ ...rig, layers: normalized });
    } finally {
      setWorking('');
    }
  };
  const setLayerApproved = (id: string, approved: boolean) => onRigChange({ ...rig, layers: rig.layers.map((layer) => layer.id === id ? { ...layer, approved } : layer) });
  const persistSkeleton = () => {
    const joints = posedJoints.map((joint) => ({ ...joint, x: Math.round(joint.x), y: Math.round(joint.y), restX: Math.round(joint.x), restY: Math.round(joint.y) }));
    const bones = rig.bones.map((bone) => { const a = joints.find((joint) => joint.id === bone.parentJointId); const b = joints.find((joint) => joint.id === bone.childJointId); return a && b ? { ...bone, length: Math.hypot(b.x - a.x, b.y - a.y) } : bone; });
    onRigChange({ ...rig, status: 'approved', joints, bones });
    setPosedJoints(joints);
    setStage('poses');
  };
  const bindBone = (boneId: string, segmentId?: string) => onRigChange({ ...rig, bones: rig.bones.map((bone) => bone.id === boneId ? { ...bone, segmentId: segmentId || undefined } : bone) });
  const undoSkeletonEdit = () => {
    const previous = skeletonHistory.current.pop();
    if (!previous) return;
    setPosedJoints(previous);
  };
  const startJointDrag = (event: React.PointerEvent<HTMLCanvasElement>) => { 
    const point = canvasPoint(event); 
    if (!point || point.x === 0 && point.y === 0) return;
    const joint = posedJoints.reduce((nearest, item) => Math.hypot(item.x - point.x, item.y - point.y) < Math.hypot(nearest.x - point.x, nearest.y - point.y) ? item : nearest, posedJoints[0]); 
    if (!joint) return; 
    dragJoint.current = joint.id; 
    event.currentTarget?.setPointerCapture(event.pointerId); 
  };
  const moveJoint = (event: React.PointerEvent<HTMLCanvasElement>) => { 
    if (!dragJoint.current) return; 
    const point = canvasPoint(event);
    if (!point || (point.x === 0 && point.y === 0)) return;
    setPosedJoints((current) => solveTwoBoneIK(current, rig.bones, dragJoint.current!, point)); 
  };
  const endJointDrag = () => { dragJoint.current = null; };
  const changeSkeletonZoom = (amount: number) => setSkeletonZoom((current) => Math.max(1, Math.min(30, Math.round((current + amount) * 2) / 2)));
  const resetSkeletonView = () => { setSkeletonZoom(1); setSkeletonPan({ x: 0, y: 0 }); setSkeletonMoveMode(false); };
  const beginSkeletonInteraction = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget) return;
    if (skeletonMoveMode) {
      event.currentTarget.setPointerCapture(event.pointerId);
      skeletonPanStart.current = { x: event.clientX, y: event.clientY, originX: skeletonPan.x, originY: skeletonPan.y };
      return;
    }
    skeletonHistory.current.push(posedJoints.map((joint) => ({ ...joint })));
    startJointDrag(event);
  };
  const moveSkeletonInteraction = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget) return;
    if (skeletonMoveMode && skeletonPanStart.current) {
      setSkeletonPan({ x: skeletonPanStart.current.originX + event.clientX - skeletonPanStart.current.x, y: skeletonPanStart.current.originY + event.clientY - skeletonPanStart.current.y });
      return;
    }
    
    // Detect hovered joint when not dragging and not in move mode
    if (!dragJoint.current && !skeletonMoveMode) {
      const point = canvasPoint(event);
      if (point && !(point.x === 0 && point.y === 0)) {
        const hitRadius = Math.max(12, width / 28);
        const nearest = posedJoints.reduce((closest, joint) => {
          const dist = Math.hypot(joint.x - point.x, joint.y - point.y);
          return dist < Math.hypot(closest.x - point.x, closest.y - point.y) ? joint : closest;
        }, posedJoints[0]);
        const nearestDist = Math.hypot(nearest.x - point.x, nearest.y - point.y);
        setHoveredJointId(nearestDist <= hitRadius ? nearest.id : null);
      }
    }
    
    moveJoint(event);
  };
  const endSkeletonInteraction = () => { skeletonPanStart.current = null; endJointDrag(); setHoveredJointId(null); };
  const selectJoint = (jointId: string) => { setSelectedJointId(jointId); setHoveredJointId(jointId); };
  const suggestPose = async () => { if (!poseDescription.trim()) return; setWorking('Planning pose…'); try { const result = await provider.suggestPose({ source, width, height, palette, segments, description: poseDescription, joints: posedJoints, bones: rig.bones }); setPosedJoints((current) => current.map((joint) => ({ ...joint, ...(result.joints[joint.id] || {}) }))); } finally { setWorking(''); } };
  const captureTimelinePose = async (frame = poseIndex) => { const frameIndex = Math.max(0, Math.min(clip.durationFrames - 1, frame)); onClipChange(capturePoseAsKeyframes(clip, frameIndex, { joints: jointMap(posedJoints), transforms: previewTransforms }, 'linear')); };
  const loadTimelineFrame = (frame: number) => { const evaluated = evaluateClip(clip, { joints: rig.joints }, frame); setPoseIndex(frame); setPosedJoints(rig.joints.map((joint) => ({ ...joint, ...(evaluated.joints[joint.id] || {}) }))); setTimelineTransforms(evaluated.transforms); };
  const savePose = async () => { await captureTimelinePose(poseIndex); };
  const addSegment = () => { const id = `segment-${Date.now()}`; onSegmentsChange([...segments, { id, name: `Section ${segments.length + 1}`, description: '', color: defaultSegmentColors[segments.length % defaultSegmentColors.length], pixels: [], pivot: { x: Math.floor(width / 2), y: Math.floor(height / 2) }, zIndex: segments.length, locked: false, visible: true }]); setActiveId(id); };

  return <section className="page rig-workspace"><div className="page-heading"><div><div className="eyebrow">OPTIONAL RIG · {cycle.name.toUpperCase()}</div><h2>Author the important poses.</h2><p>Build approved layers and key poses, then let the generator draw only the frames between them.</p></div><button className="ghost" onClick={onContinue}>Return to cycles</button></div><div className="rig-stage-tabs">{stages.map((item) => <button key={item.id} className={stage === item.id ? 'active' : ''} onClick={() => setStage(item.id)}>{item.label}{item.id === 'analyze' && rig.status === 'approved' ? <Check size={13}/> : null}</button>)}</div>{working && <div className="rig-working"><LoaderCircle className="spin" size={15}/>{working}</div>}
  {stage === 'analyze' && <div className="rig-stage-layout">
    <aside className="rig-side"><span className="label">REGIONS</span><button className="primary" disabled={Boolean(working)} onClick={analyze}><Sparkles size={15}/> Analyze sprite</button><button className="ghost" onClick={addSegment}><Plus size={14}/> Add custom region</button><div className="segment-list">{segments.map((segment) => <button key={segment.id} className={`segment-item ${activeId === segment.id ? 'active' : ''}`} onClick={() => setActiveId(segment.id)}><i style={{ background: segment.color }}/><span><strong>{segment.name}</strong><small>{segment.pixels.length} pixels</small></span></button>)}</div>{activeSegment && <><input value={activeSegment.name} onChange={(event) => onSegmentsChange(segments.map((segment) => segment.id === activeId ? { ...segment, name: event.target.value } : segment))}/><label className="brush-control">BRUSH <input type="range" min="1" max="25" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))}/><output>{brushSize}px</output></label><small>{maskTool === 'erase' ? 'Drag to remove pixels from this region.' : maskTool === 'pan' ? 'Drag the canvas to reposition the view.' : 'Drag to assign pixels. Hold Shift to erase.'}</small></>}</aside>
    <div className="rig-main checker">
      <div className="mask-toolbar" role="toolbar" aria-label="Segmentation canvas tools"><div className="mask-tool-group"><button className={maskTool === 'paint' ? 'active' : ''} onClick={() => setMaskTool('paint')} title="Paint pixels into the selected region"><Paintbrush size={15}/><span>Paint</span></button><button className={maskTool === 'erase' ? 'active' : ''} onClick={() => setMaskTool('erase')} title="Erase pixels from the selected region"><Eraser size={15}/><span>Erase</span></button><button className={maskTool === 'pan' ? 'active' : ''} onClick={() => setMaskTool('pan')} title="Reposition the canvas"><Hand size={15}/><span>Move</span></button></div><div className="mask-tool-group zoom-tools"><button onClick={() => changeMaskZoom(-.25)} disabled={maskZoom <= .5} aria-label="Zoom out"><ZoomOut size={15}/></button><output>{Math.round(maskZoom * 100)}%</output><button onClick={() => changeMaskZoom(.25)} disabled={maskZoom >= 5} aria-label="Zoom in"><ZoomIn size={15}/></button><button onClick={undoMaskEdit} disabled={!maskHistory.current.length} title="Undo last mask change"><Undo2 size={14}/><span>Undo</span></button><button onClick={resetMaskView} title="Reset zoom and position"><RotateCcw size={14}/><span>Reset</span></button></div></div>
      <div className="mask-canvas-viewport"><canvas ref={maskCanvas} className={`mask-canvas tool-${maskTool}`} style={{ transform: `translate(${maskPan.x}px, ${maskPan.y}px) scale(${maskZoom})` }} onPointerDown={beginMaskInteraction} onPointerMove={moveMaskInteraction} onPointerUp={endMaskInteraction} onPointerCancel={endMaskInteraction}/></div>
    </div>
    <aside className="rig-review"><span className="label">APPROVAL</span><h3>Confirm ownership</h3><p>Each opaque pixel can belong to one region. Correct the suggested masks before creating layers.</p><button className="primary" disabled={!segments.length} onClick={approveAnalysis}><Check size={15}/> Approve analysis</button></aside>
  </div>}
  {stage === 'layers' && <div className="layers-workspace"><div className="layers-intro"><div><span className="label">ANIMATION LAYERS</span><h3>Review each full body part.</h3><p>Foreground segments are removed virtually, then Pixelmate fills the layer underneath without changing its visible source pixels.</p></div><button className="ghost" disabled={Boolean(working) || !rig.layers.some((layer) => candidatePixels(layer).length)} onClick={() => completeLayers()}><WandSparkles size={15}/> Improve all fills</button></div><div className="layer-grid">{rig.layers.map((layer) => { const generatedCount = layer.generatedPixels?.length || 0; const candidateCount = candidatePixels(layer).length; const completionLabel = layer.completionMode === 'generated' || layer.completionMode === 'refined' ? 'generated' : 'cloned'; return <article className={`layer-card ${layer.approved ? 'approved' : ''}`} key={layer.id}><div className="layer-preview checker"><LayerPreview source={source} completedSrc={layer.completedSrc} pixels={layer.visiblePixels} width={width} height={height}/></div><div className="layer-card-copy"><strong>{layer.name}</strong><span>{layer.visiblePixels.length.toLocaleString()} visible pixels</span><small>{generatedCount ? `${generatedCount.toLocaleString()} hidden pixels ${completionLabel}` : candidateCount ? `${candidateCount.toLocaleString()} possible hidden pixels` : 'No foreground overlap detected'}</small></div><div className="layer-card-actions">{candidateCount > 0 && <button className="ghost" disabled={Boolean(working)} onClick={() => completeLayers([layer.id])}><WandSparkles size={13}/>{layer.completionMode === 'generated' || layer.completionMode === 'refined' ? 'Regenerate fill' : 'Improve fill'}</button>}<button className="ghost" onClick={() => setLayerApproved(layer.id, !layer.approved)}>{layer.approved ? <><Check size={13}/> Ready</> : 'Approve completion'}</button></div></article>; })}</div><div className="layers-footer"><span>{rig.layers.filter((layer) => layer.approved).length} of {rig.layers.length} layers ready</span><button className="primary" disabled={!rig.layers.length || rig.layers.some((layer) => !layer.approved)} onClick={() => setStage('skeleton')}>Continue to skeleton</button></div></div>}
  {stage === 'skeleton' && <div className="skeleton-workspace"><div className="skeleton-stage checker"><div className="skeleton-toolbar" role="toolbar" aria-label="Skeleton canvas tools"><button className={skeletonMoveMode ? 'active' : ''} onClick={() => setSkeletonMoveMode((current) => !current)} title="Move the skeleton canvas"><Hand size={14}/><span>Move</span></button><button onClick={() => changeSkeletonZoom(-.5)} disabled={skeletonZoom <= 1} aria-label="Zoom out"><ZoomOut size={14}/></button><output>{Math.round(skeletonZoom * 100)}%</output><button onClick={() => changeSkeletonZoom(.5)} disabled={skeletonZoom >= 30} aria-label="Zoom in"><ZoomIn size={14}/></button><button onClick={undoSkeletonEdit} disabled={!skeletonHistory.current.length} title="Undo last joint change"><Undo2 size={14}/><span>Undo</span></button><button onClick={resetSkeletonView} title="Reset zoom and position"><RotateCcw size={14}/><span>Reset</span></button></div><div className="skeleton-canvas-viewport"><canvas ref={skeletonCanvas} className={`skeleton-canvas ${skeletonMoveMode ? 'moving' : ''}`} style={{ transform: `translate(${skeletonPan.x}px, ${skeletonPan.y}px) scale(${skeletonZoom})` }} onPointerDown={(event) => { const point = canvasPoint(event); const nearest = posedJoints.reduce((closest, joint) => Math.hypot(joint.x - point.x, joint.y - point.y) < Math.hypot(closest.x - point.x, closest.y - point.y) ? joint : closest, posedJoints[0]); if (nearest) selectJoint(nearest.id); beginSkeletonInteraction(event); }} onPointerMove={moveSkeletonInteraction} onPointerUp={endSkeletonInteraction} onPointerCancel={endSkeletonInteraction} onPointerLeave={endSkeletonInteraction}/></div></div><aside className="skeleton-inspector"><span className="label">SKELETON</span><h3>Drag a joint</h3><p>Hands and feet use two-bone IK. Layer transforms remain integer-positioned with nearest-neighbor rotation.</p><div className="joint-list">{posedJoints.map((joint) => <button key={joint.id} ref={(element) => { jointListRefs.current[joint.id] = element; }} className={`joint-item ${selectedJointId === joint.id ? 'active' : ''} ${hoveredJointId === joint.id ? 'hovered' : ''}`} onClick={() => selectJoint(joint.id)}><strong>{joint.name}</strong><span>{joint.x}, {joint.y}</span></button>)}</div><div className="bone-bindings"><span className="label">BONE BINDINGS</span>{rig.bones.map((bone) => <label key={bone.id}><span>{bone.name}</span><select value={bone.segmentId || ''} onChange={(event) => bindBone(bone.id, event.target.value)}><option value="">Unbound</option>{segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</select></label>)}</div><button className="ghost" onClick={() => setPosedJoints(rig.joints)}><RotateCcw size={14}/> Reset pose</button><button className="primary" onClick={persistSkeleton}>Save skeleton</button></aside><div className="skeleton-preview checker"><div className="skeleton-preview-toolbar" role="toolbar" aria-label="Composed pose preview controls"><button className={previewMoveMode ? 'active' : ''} onClick={() => setPreviewMoveMode((current) => !current)} title="Move the composed pose"><Hand size={14}/><span>Move</span></button><button onClick={() => changePreviewZoom(-.25)} disabled={previewZoom <= .5} aria-label="Zoom out"><ZoomOut size={14}/></button><output>{Math.round(previewZoom * 100)}%</output><button onClick={() => changePreviewZoom(.25)} disabled={previewZoom >= 4} aria-label="Zoom in"><ZoomIn size={14}/></button><button onClick={resetPreviewView} title="Reset zoom and position"><RotateCcw size={14}/><span>Reset</span></button></div><div className="skeleton-preview-viewport"><img className={previewMoveMode ? 'moving' : ''} src={preview} draggable={false} style={{ transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})` }} onPointerDown={beginPreviewInteraction} onPointerMove={movePreview} onPointerUp={endPreviewInteraction} onPointerCancel={endPreviewInteraction}/></div><span>COMPOSED POSE</span></div></div>}
  {stage === 'poses' && <div className="poses-workspace timeline-workspace"><div className="pose-author"><div className="pose-preview checker"><img src={preview}/><span>FRAME {poseIndex + 1}</span></div><div className="pose-fields"><label>POSE NAME<input value={poseName} onChange={(event) => setPoseName(event.target.value)}/></label><label>FRAME POSITION<input type="number" min="0" max={Math.max(0, clip.durationFrames - 1)} value={poseIndex} onChange={(event) => loadTimelineFrame(Number(event.target.value))}/></label><label>POSE DESCRIPTION<textarea value={poseDescription} onChange={(event) => setPoseDescription(event.target.value)} placeholder="e.g. waving hello, right hand raised beside the head"/></label><div><button className="ghost" disabled={!poseDescription.trim() || Boolean(working)} onClick={suggestPose}><Sparkles size={14}/> Suggest pose</button><button className="primary" onClick={savePose}><Plus size={14}/> Key current pose</button></div></div></div><TimelineEditor clip={clip} onChange={onClipChange} targets={[...rig.joints.map((joint) => ({ id: joint.id, kind: 'joint' as const, label: joint.name })), ...segments.map((segment) => ({ id: segment.id, kind: 'segment' as const, label: segment.name }))]} onPlayheadChange={loadTimelineFrame} onCapturePose={captureTimelinePose}/><div className="pose-actions"><button className="primary" disabled={busy || clip.tracks.flatMap((track) => track.keyframes).length < 2} onClick={onGenerateInbetweens}><WandSparkles size={15}/> Render timeline frames</button><small>Authored keys remain immutable while AI renders only deterministic in-between guides.</small></div></div>}
  </section>;
}

export function RigFrameControls({ segments, transforms, onChange }: { segments: Segment[]; transforms: Record<string, SegmentTransform>; onChange: (transforms: Record<string, SegmentTransform>) => void }) { const update = (id: string, patch: Partial<SegmentTransform>) => onChange({ ...transforms, [id]: { ...neutralTransform(), ...(transforms[id] || {}), ...patch } }); return <div className="frame-rig-controls"><div><span className="label">SEGMENT POSE</span><p>Adjust this frame without redrawing its pixels.</p></div>{segments.map((segment) => { const transform = { ...neutralTransform(), ...(transforms[segment.id] || {}) }; return <div className="frame-rig-row" key={segment.id}><i style={{ background: segment.color }}/><strong>{segment.name}</strong><input aria-label={`${segment.name} x`} type="number" value={transform.x} onChange={(event) => update(segment.id, { x: Number(event.target.value) })}/><input aria-label={`${segment.name} y`} type="number" value={transform.y} onChange={(event) => update(segment.id, { y: Number(event.target.value) })}/><input aria-label={`${segment.name} rotation`} type="number" value={transform.rotation} onChange={(event) => update(segment.id, { rotation: Number(event.target.value) })}/><button onClick={() => update(segment.id, { visible: !transform.visible })}>{transform.visible ? <Eye size={13}/> : <EyeOff size={13}/>}</button></div>; })}</div>; }
