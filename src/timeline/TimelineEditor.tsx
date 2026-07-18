import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MotionClip, MotionInterpolation, MotionKeyframe, MotionProperty, MotionTrack } from '../animation';
import { evaluateTrack, moveKeyframes, upsertKeyframe } from '../animation';
import './timeline.css';

export type TimelineTarget = { id: string; kind: MotionTrack['targetKind']; label: string };

export type TimelineEditorProps = {
  clip: MotionClip;
  onChange: (clip: MotionClip) => void;
  targets?: TimelineTarget[];
  className?: string;
  onPlayheadChange?: (frame: number) => void;
  onCapturePose?: (frame: number) => void;
  onAutoKeyChange?: (enabled: boolean) => void;
};

type ClipboardKey = Pick<MotionKeyframe, 'value' | 'interpolation' | 'frame'> & { trackId: string };
type History = { past: MotionClip[]; future: MotionClip[] };
type Drag = { startX: number; origin: MotionClip; ids: Set<string>; delta: number };

const FRAME_WIDTH = 24;
const LABEL_WIDTH = 188;
const PROPERTIES: MotionProperty[] = ['x', 'y', 'rotation', 'visible', 'zIndex'];
const INTERPOLATIONS: MotionInterpolation[] = ['stepped', 'linear', 'ease-in', 'ease-out', 'ease-both'];

const clampFrame = (clip: MotionClip, frame: number) => Math.max(0, Math.min(Math.max(0, clip.durationFrames - 1), Math.round(frame)));
const makeId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

function updateTracks(clip: MotionClip, fn: (track: MotionTrack) => MotionTrack): MotionClip {
  return { ...clip, tracks: clip.tracks.map(fn) };
}

function trackLabel(track: MotionTrack): string {
  return `${track.targetId} · ${track.property}`;
}

export function TimelineEditor({ clip, onChange, targets = [], className = '', onPlayheadChange, onCapturePose, onAutoKeyChange }: TimelineEditorProps) {
  const [playhead, setPlayheadState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [autoKey, setAutoKey] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const [clipboard, setClipboard] = useState<ClipboardKey[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const clipRef = useRef(clip);
  const frameRef = useRef(playhead);
  clipRef.current = clip;
  frameRef.current = playhead;

  const setPlayhead = useCallback((frame: number) => {
    const next = clampFrame(clipRef.current, frame);
    frameRef.current = next;
    setPlayheadState(next);
    onPlayheadChange?.(next);
  }, [onPlayheadChange]);

  const commit = useCallback((next: MotionClip, origin = clipRef.current) => {
    if (next === origin) return;
    setHistory(value => ({ past: [...value.past.slice(-99), origin], future: [] }));
    onChange(next);
  }, [onChange]);

  const undo = useCallback(() => {
    setHistory(value => {
      const previous = value.past[value.past.length - 1];
      if (!previous) return value;
      onChange(previous);
      return { past: value.past.slice(0, -1), future: [clipRef.current, ...value.future].slice(0, 100) };
    });
  }, [onChange]);

  const redo = useCallback(() => {
    setHistory(value => {
      const next = value.future[0];
      if (!next) return value;
      onChange(next);
      return { past: [...value.past, clipRef.current].slice(-100), future: value.future.slice(1) };
    });
  }, [onChange]);

  const deleteSelected = useCallback(() => {
    if (!selected.size) return;
    commit(updateTracks(clipRef.current, track => ({ ...track, keyframes: track.keyframes.filter(key => !selected.has(key.id)) })));
    setSelected(new Set());
  }, [commit, selected]);

  const copySelected = useCallback(() => {
    const copied = clipRef.current.tracks.flatMap(track => track.keyframes
      .filter(key => selected.has(key.id))
      .map(key => ({ trackId: track.id, frame: key.frame, value: key.value, interpolation: key.interpolation })));
    if (copied.length) setClipboard(copied);
  }, [selected]);

  const paste = useCallback((duplicate = false) => {
    let source = clipboard;
    if (duplicate) {
      source = clipRef.current.tracks.flatMap(track => track.keyframes
        .filter(key => selected.has(key.id))
        .map(key => ({ trackId: track.id, frame: key.frame, value: key.value, interpolation: key.interpolation })));
    }
    if (!source.length) return;
    const first = Math.min(...source.map(key => key.frame));
    const ids = new Set<string>();
    const next = updateTracks(clipRef.current, track => {
      let updated = track;
      for (const key of source.filter(item => item.trackId === track.id)) {
        const id = makeId('key');
        ids.add(id);
        updated = upsertKeyframe(updated, { ...key, id, frame: clampFrame(clipRef.current, frameRef.current + key.frame - first) });
      }
      return updated;
    });
    commit(next);
    setSelected(ids);
  }, [clipboard, commit, selected]);

  const setInterpolation = useCallback((interpolation: MotionInterpolation) => {
    if (!selected.size) return;
    commit(updateTracks(clipRef.current, track => ({ ...track, keyframes: track.keyframes.map(key => selected.has(key.id) ? { ...key, interpolation } : key) })));
  }, [commit, selected]);

  const addKey = useCallback((track: MotionTrack) => {
    const current = evaluateTrack(track, frameRef.current);
    const value = current ?? (track.property === 'visible' ? true : 0);
    const id = makeId('key');
    const next = updateTracks(clipRef.current, item => item.id === track.id
      ? upsertKeyframe(item, { id, frame: frameRef.current, value, interpolation: 'linear' })
      : item);
    commit(next);
    setSelected(new Set([id]));
  }, [commit]);

  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    let request = 0;
    let remainder = 0;
    const tick = (now: number) => {
      remainder += ((now - previous) / 1000) * clipRef.current.fps * playbackRate;
      previous = now;
      if (remainder >= 1) {
        const advance = Math.floor(remainder);
        remainder -= advance;
        const active = clipRef.current;
        let next = frameRef.current + advance;
        if (next > active.loopEnd) {
          if (active.loop) next = active.loopStart + ((next - active.loopStart) % Math.max(1, active.loopEnd - active.loopStart + 1));
          else { next = active.loopEnd; setPlaying(false); }
        }
        setPlayhead(next);
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, playbackRate, setPlayhead]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (element?.matches('input, select, textarea')) return;
      const mod = event.metaKey || event.ctrlKey;
      if (event.code === 'Space') { event.preventDefault(); setPlaying(value => !value); }
      else if (event.key.toLowerCase() === 'k') { event.preventDefault(); onCapturePose?.(frameRef.current); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
      else if (mod && event.key.toLowerCase() === 'z' && event.shiftKey) { event.preventDefault(); redo(); }
      else if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
      else if (mod && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected(); }
      else if (mod && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(); }
      else if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); paste(true); }
      else if (event.key === 'ArrowLeft') setPlayhead(frameRef.current - 1);
      else if (event.key === 'ArrowRight') setPlayhead(frameRef.current + 1);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [copySelected, deleteSelected, onCapturePose, paste, redo, setPlayhead, undo]);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const delta = Math.round((event.clientX - drag.startX) / FRAME_WIDTH);
      if (delta === drag.delta) return;
      setDrag(value => value ? { ...value, delta } : null);
      onChange(updateTracks(drag.origin, track => moveKeyframes(track, drag.ids, delta)));
    };
    const up = () => {
      if (drag.delta !== 0) setHistory(value => ({ past: [...value.past.slice(-99), drag.origin], future: [] }));
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, onChange]);

  const targetGroups = useMemo(() => {
    const labels = new Map(targets.map(target => [`${target.kind}:${target.id}`, target.label]));
    const map = new Map<string, { key: string; label: string; tracks: MotionTrack[] }>();
    for (const track of clip.tracks) {
      const key = `${track.targetKind}:${track.targetId}`;
      const group = map.get(key) ?? { key, label: labels.get(key) ?? track.targetId, tracks: [] };
      group.tracks.push(track);
      map.set(key, group);
    }
    return [...map.values()];
  }, [clip.tracks, targets]);

  const selectedInterpolation = clip.tracks.flatMap(track => track.keyframes).find(key => selected.has(key.id))?.interpolation ?? 'linear';
  const timelineWidth = Math.max(1, clip.durationFrames) * FRAME_WIDTH;
  const selectKey = (event: React.PointerEvent, key: MotionKeyframe) => {
    event.stopPropagation();
    const next = event.metaKey || event.ctrlKey || event.shiftKey ? new Set(selected) : new Set<string>();
    if (next.has(key.id) && (event.metaKey || event.ctrlKey)) next.delete(key.id); else next.add(key.id);
    setSelected(next);
    setDrag({ startX: event.clientX, origin: clipRef.current, ids: next, delta: 0 });
  };

  const row = (label: string, tracks: MotionTrack[], summary = false) => (
    <div className={`pm-track-row${summary ? ' is-summary' : ''}`} key={label}>
      <div className="pm-track-label">{label}{!summary && tracks.length === 1 && <button title="Add key at playhead" onClick={() => addKey(tracks[0])}>＋</button>}</div>
      <div className="pm-track-lane" style={{ width: timelineWidth }} onPointerDown={event => {
        if (event.target === event.currentTarget) { setSelected(new Set()); setPlayhead((event.clientX - event.currentTarget.getBoundingClientRect().left) / FRAME_WIDTH); }
      }}>
        {tracks.flatMap(track => track.keyframes.map(key => <button
          key={`${summary ? 's-' : ''}${key.id}`}
          className={`pm-key${selected.has(key.id) ? ' is-selected' : ''}`}
          style={{ left: key.frame * FRAME_WIDTH }}
          title={`${trackLabel(track)} · frame ${key.frame}`}
          onPointerDown={event => selectKey(event, key)}
        />))}
      </div>
    </div>
  );

  return <section className={`pm-timeline ${className}`} aria-label="Animation timeline">
    <div className="pm-transport">
      <button onClick={() => setPlayhead(clip.loopStart)} title="Loop start">|◀</button>
      <button className={playing ? 'is-active' : ''} onClick={() => setPlaying(value => !value)}>{playing ? 'Pause' : 'Play'}</button>
      <button onClick={() => setPlayhead(clip.loopEnd)} title="Loop end">▶|</button>
      <span className="pm-frame-readout">{playhead + 1} / {clip.durationFrames}</span>
      <label>FPS <input type="number" min="1" max="120" value={clip.fps} onChange={event => commit({ ...clip, fps: Math.max(1, Number(event.target.value)) })} /></label>
      <label>Speed <select value={playbackRate} onChange={event => setPlaybackRate(Number(event.target.value))}><option value={0.5}>½×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
      <button className={clip.loop ? 'is-active' : ''} onClick={() => commit({ ...clip, loop: !clip.loop })}>Loop</button>
      <label>In <input type="number" min="0" max={clip.loopEnd} value={clip.loopStart} onChange={event => commit({ ...clip, loopStart: clampFrame(clip, Number(event.target.value)) })} /></label>
      <label>Out <input type="number" min={clip.loopStart} max={clip.durationFrames - 1} value={clip.loopEnd} onChange={event => commit({ ...clip, loopEnd: clampFrame(clip, Number(event.target.value)) })} /></label>
      <button className={autoKey ? 'is-active danger' : ''} onClick={() => setAutoKey(value => { const next = !value; onAutoKeyChange?.(next); return next; })}>Auto-key</button>
      <button disabled={!onCapturePose} onClick={() => onCapturePose?.(playhead)}>Key pose</button>
    </div>
    <div className="pm-editbar">
      <button disabled={!history.past.length} onClick={undo}>Undo</button><button disabled={!history.future.length} onClick={redo}>Redo</button>
      <button disabled={!selected.size} onClick={copySelected}>Copy</button><button disabled={!clipboard.length} onClick={() => paste()}>Paste</button>
      <button disabled={!selected.size} onClick={() => paste(true)}>Duplicate</button><button disabled={!selected.size} onClick={deleteSelected}>Delete</button>
      <label>Easing <select disabled={!selected.size} value={selectedInterpolation} onChange={event => setInterpolation(event.target.value as MotionInterpolation)}>{INTERPOLATIONS.map(value => <option key={value}>{value}</option>)}</select></label>
      <span className="pm-hint">Space play · K key · ⌘D duplicate</span>
    </div>
    <div className="pm-scroll">
      <div className="pm-ruler-row">
        <div className="pm-ruler-label">{clip.name}</div>
        <div className="pm-ruler" style={{ width: timelineWidth }} onPointerDown={event => setPlayhead((event.clientX - event.currentTarget.getBoundingClientRect().left) / FRAME_WIDTH)}>
          {Array.from({ length: clip.durationFrames }, (_, frame) => <span key={frame} style={{ left: frame * FRAME_WIDTH }}>{frame + 1}</span>)}
        </div>
      </div>
      <div className="pm-grid" style={{ minWidth: LABEL_WIDTH + timelineWidth }}>
        <div className="pm-playhead" style={{ left: LABEL_WIDTH + playhead * FRAME_WIDTH }} />
        {row('All keyed properties', clip.tracks, true)}
        {targetGroups.map(group => <div className="pm-target" key={group.key}>
          <button className="pm-target-heading" onClick={() => setExpanded(value => { const next = new Set(value); next.has(group.key) ? next.delete(group.key) : next.add(group.key); return next; })}>
            <span>{expanded.has(group.key) ? '▾' : '▸'}</span>{group.label}<small>{group.tracks[0]?.targetKind}</small>
          </button>
          {row('', group.tracks, true)}
          {expanded.has(group.key) && group.tracks
            .sort((a, b) => PROPERTIES.indexOf(a.property) - PROPERTIES.indexOf(b.property))
            .map(track => row(track.property, [track]))}
        </div>)}
      </div>
    </div>
  </section>;
}

export default TimelineEditor;
