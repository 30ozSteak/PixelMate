import { useMemo, useState } from 'react';
import { Check, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { extractRenderRecipe, renderLockedSkin, validateSemanticModel, type MaterialSlot, type PlayerSkin, type SemanticModel, type SkinReference } from './characterModel';

type Props = {
  model: SemanticModel;
  skins: PlayerSkin[];
  activeSkinId: string | null;
  source: string;
  busy: boolean;
  onModelChange: (model: SemanticModel) => void;
  onChange: (skins: PlayerSkin[], activeSkinId: string | null) => void;
  onApply: (skin: PlayerSkin, renderedSource: string) => void;
  onContinue: () => void;
};

const materialSlots: MaterialSlot[] = ['skin', 'hair', 'shirt', 'jacket', 'pants', 'metal', 'leather', 'emissive', 'unassigned'];
const readReferences = (files: FileList) => Promise.all([...files].slice(0, 8).map((file) => new Promise<SkinReference>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ id: `${Date.now()}-${file.name}`, name: file.name, src: reader.result as string }); reader.onerror = reject; reader.readAsDataURL(file); })));

export function SkinView({ model, skins, activeSkinId, source, busy, onModelChange, onChange, onApply, onContinue }: Props) {
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState(source);
  const [name, setName] = useState('Player skin');
  const active = skins.find((skin) => skin.id === activeSkinId) || skins[0];
  const findings = useMemo(() => validateSemanticModel(model), [model]);

  const createSkin = async (files: FileList | null) => {
    if (!files?.length) return;
    setWorking(true);
    try {
      const references = await readReferences(files);
      const recipe = await extractRenderRecipe(references);
      const skin: PlayerSkin = { id: `skin-${Date.now()}`, name: name.trim() || 'Player skin', references, recipe, attachments: {}, provenance: { provider: 'local', createdAt: new Date().toISOString() }, approved: false };
      onChange([...skins, skin], skin.id);
      setPreview(await renderLockedSkin(model, skin, source));
    } finally { setWorking(false); }
  };
  const update = (patch: Partial<PlayerSkin>) => active && onChange(skins.map((skin) => skin.id === active.id ? { ...skin, ...patch, approved: false } : skin), active.id);
  const updateRecipe = (patch: Partial<PlayerSkin['recipe']>) => active && update({ recipe: { ...active.recipe, ...patch } });
  const updatePart = (partId: string, materialSlot: MaterialSlot) => onModelChange({ ...model, approved: false, parts: model.parts.map((part) => part.id === partId ? { ...part, materialSlot } : part) });
  const updateAttachment = (kind: keyof PlayerSkin['attachments'], value: string) => active && update({ attachments: { ...active.attachments, [kind]: value } });
  const select = async (skin: PlayerSkin) => { onChange(skins, skin.id); setPreview(await renderLockedSkin(model, skin, source)); };
  const apply = async () => { if (!active) return; setWorking(true); try { const rendered = await renderLockedSkin(model, active, source); setPreview(rendered); onApply({ ...active, approved: true }, rendered); } finally { setWorking(false); } };

  return <section className="page skin-page">
    <div className="page-heading"><div><div className="eyebrow">PLAYER SKINS</div><h2>Texture motion, not geometry.</h2><p>Extract a player character recipe and repaint the approved model without changing its silhouette or rig.</p></div><button className="primary" disabled={!active?.approved} onClick={onContinue}>Continue to refine</button></div>
    <div className="skin-workbench">
      <aside className="skin-library"><span className="label">SKIN LIBRARY</span><div className="skin-create"><input value={name} onChange={(event) => setName(event.target.value)} aria-label="New skin name"/><label className="skin-upload"><Upload size={15}/><span>Add player references</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => createSkin(event.target.files)}/></label></div><div className="skin-list">{skins.map((skin) => <button key={skin.id} className={active?.id === skin.id ? 'active' : ''} onClick={() => select(skin)}><span>{skin.references[0] ? <img src={skin.references[0].src}/> : <Plus/>}</span><strong>{skin.name}</strong><small>{skin.recipe.palette.length} colors · {skin.approved ? 'approved' : 'draft'}</small></button>)}{!skins.length && <p>Upload one or more images of a player character to create the first reusable skin.</p>}</div></aside>
      <div className="skin-stage checker"><div className="skin-compare"><div><span>CANONICAL MODEL</span><img src={source}/></div><div><span>LOCKED-SKIN PREVIEW</span><img src={preview}/></div></div><div className="skin-lock-status"><Check size={14}/> Body masks, rig, pivot, scale, and baseline remain locked</div></div>
      <aside className="skin-recipe"><span className="label">RENDER RECIPE</span>{active ? <>
        <label>SKIN NAME<input value={active.name} onChange={(event) => update({ name: event.target.value })}/></label>
        <div className="recipe-palette">{active.recipe.palette.map((color, index) => <label key={`${color}-${index}`} title={color}><input type="color" value={color} onChange={(event) => updateRecipe({ palette: active.recipe.palette.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })}/></label>)}</div>
        <div className="recipe-grid"><label>OUTLINE<input type="number" min="0" max="3" value={active.recipe.outlineWidth} onChange={(event) => updateRecipe({ outlineWidth: Number(event.target.value) })}/></label><label>SHADING BANDS<input type="number" min="1" max="6" value={active.recipe.shadingBands} onChange={(event) => updateRecipe({ shadingBands: Number(event.target.value) })}/></label><label>LIGHT<select value={active.recipe.lightDirection} onChange={(event) => updateRecipe({ lightDirection: event.target.value as PlayerSkin['recipe']['lightDirection'] })}><option value="top-left">Top left</option><option value="top">Top</option><option value="top-right">Top right</option></select></label><label>CLUSTER SCALE<input type="number" min="1" max="4" value={active.recipe.clusterScale} onChange={(event) => updateRecipe({ clusterScale: Number(event.target.value) })}/></label></div>
        <label>FACE RULES<textarea value={active.recipe.facialRules} onChange={(event) => updateRecipe({ facialRules: event.target.value })} placeholder="Eye shape, mouth treatment, markings…"/></label>
        <label>MUST PRESERVE<textarea value={active.recipe.mustPreserve} onChange={(event) => updateRecipe({ mustPreserve: event.target.value })} placeholder="Hair colors, jacket pattern, equipment…"/></label>
        <div className="part-mapping"><span className="label">SEMANTIC MATERIALS</span>{model.parts.map((part) => <label key={part.id}><span>{part.name}</span><select value={part.materialSlot} onChange={(event) => updatePart(part.id, event.target.value as MaterialSlot)}>{materialSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></label>)}</div>
        <div className="attachment-mapping"><span className="label">RIGGED ATTACHMENTS</span>{model.attachments.map((slot) => <label key={slot.id}><span>{slot.name}<small>{slot.parentJointId}</small></span><input value={active.attachments[slot.kind] || ''} onChange={(event) => updateAttachment(slot.kind, event.target.value)} placeholder="None, or describe this player trait"/></label>)}</div>
        {findings.length > 0 && <div className="skin-findings">{findings.slice(0, 4).map((finding) => <p key={finding.id} className={finding.severity}>{finding.message}</p>)}</div>}
        <button className="primary" disabled={working || busy || findings.some((finding) => finding.severity === 'error')} onClick={apply}>{working ? <Sparkles className="spin" size={15}/> : <Sparkles size={15}/>} Apply locked skin</button>
        <button className="danger-text" onClick={() => { const next = skins.filter((skin) => skin.id !== active.id); onChange(next, next[0]?.id || null); setPreview(source); }}><Trash2 size={13}/> Delete skin</button>
      </> : <div className="skin-empty">No skin selected.</div>}</aside>
    </div>
  </section>;
}
