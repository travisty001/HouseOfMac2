import { useEffect, useRef, useState } from 'react';
import { makeEdgeMap, paintMark, snapPoint, traceEdge } from './engine/annotations.js';
import { captureFilename } from './engine/runtime.js';
import { downloadBlob } from './engine/workbench.js';

const tools = { outline: 'Outline', arrow: 'Arrow', pin: 'Numbered pin' };
const confidenceValues = ['Unrated', 'Tentative', 'Probable', 'Strong'];

export default function MaskEditor({ source, onClose, name = 'specimen', initialMarks = [] }) {
  const canvas = useRef(null), map = useRef(null), close = useRef(null);
  const [image, setImage] = useState(null);
  const [failure, setFailure] = useState('');
  const [history, setHistory] = useState({ past: [], marks: initialMarks, future: [] });
  const [draft, setDraft] = useState(null);
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tool, setTool] = useState('outline');
  const [snap, setSnap] = useState(true);
  const [radius, setRadius] = useState(14);
  const [style, setStyle] = useState({ color: '#7777ff', width: 2, fill: false });
  const { marks, past, future } = history;
  const selectedMark = marks[selected];

  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = canvas.current;
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      map.current = makeEdgeMap(ctx.getImageData(0, 0, c.width, c.height));
      setImage(img);
    };
    img.onerror = () => setFailure('The captured image could not be opened.');
    img.src = source;
    return () => { img.onload = img.onerror = null; };
  }, [source]);

  function commit(next) {
    setHistory(current => ({ past: [...current.past, current.marks], marks: next, future: [] }));
  }

  function undo() {
    if (draft) {
      setDraft(draft.anchors.length > 1 ? { anchors: draft.anchors.slice(0, -1), segments: draft.segments.slice(0, -1) } : null);
      return;
    }
    if (!past.length) return;
    setHistory({ past: past.slice(0, -1), marks: past.at(-1), future: [marks, ...future] });
    setSelected(null);
  }

  function redo() {
    if (!future.length || draft) return;
    setHistory({ past: [...past, marks], marks: future[0], future: future.slice(1) });
    setSelected(null);
  }

  function updateMark(patch) {
    if (selectedMark) commit(marks.map((mark, i) => i === selected ? { ...mark, ...patch } : mark));
  }

  function finish(points, closed = false) {
    commit([...marks, { type: tool, points, closed, ...style, text: '', notes: '', confidence: 'Unrated' }]);
    setSelected(marks.length);
    setDraft(null);
    setHover(null);
  }

  function segment(a, b) {
    return tool === 'outline' ? traceEdge(a, b, snap ? map.current : null, radius) : [a, b];
  }

  function finishDraft(closed) {
    if (!draft || draft.anchors.length < (closed ? 3 : 2)) return;
    const points = [draft.anchors[0], ...draft.segments.flatMap(path => path.slice(1))];
    if (closed) points.push(...segment(draft.anchors.at(-1), draft.anchors[0]).slice(1));
    finish(points, closed);
  }

  function coords(event) {
    const rect = canvas.current.getBoundingClientRect();
    const bounded = (n, max) => Math.max(0, Math.min(max - 1, n));
    const point = {
      x: bounded((event.clientX - rect.left) * image.width / rect.width, image.width),
      y: bounded((event.clientY - rect.top) * image.height / rect.height, image.height),
    };
    return tool === 'outline' && snap ? snapPoint(point, map.current, radius) : point;
  }

  function place(event) {
    if (!image) return;
    const point = coords(event);
    if (tool === 'pin') { finish([point]); return; }
    if (!draft) { setDraft({ anchors: [point], segments: [] }); setSelected(null); return; }
    if (tool === 'arrow') { finish([draft.anchors[0], point]); return; }
    const first = draft.anchors[0];
    if (draft.anchors.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) < 12) {
      finishDraft(true);
      return;
    }
    setDraft({ anchors: [...draft.anchors, point], segments: [...draft.segments, segment(draft.anchors.at(-1), point)] });
  }

  function paint(c, preview) {
    if (!image) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(image, 0, 0);
    marks.forEach((mark, index) => paintMark(ctx, mark, index + 1));
    if (!preview || !draft) return;
    const points = [draft.anchors[0], ...draft.segments.flatMap(path => path.slice(1))];
    if (hover) points.push(...segment(draft.anchors.at(-1), hover).slice(1));
    paintMark(ctx, { type: tool, points, ...style }, marks.length + 1);
    ctx.fillStyle = '#ffffff';
    for (const point of draft.anchors) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  useEffect(() => { paint(canvas.current, true); });

  async function exportImage() {
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    paint(c, false);
    const png = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    if (png) downloadBlob(png, captureFilename(name, 'png').replace(/\.png$/, '-annotated.png'));
    else setFailure('The browser could not encode an annotated PNG.');
  }

  function exportProject() {
    const blob = new Blob([JSON.stringify({ version: 1, specimen: name, image: source, marks })], { type: 'application/json' });
    downloadBlob(blob, captureFilename(name, 'json').replace(/\.json$/, '-annotations.json'));
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); if (draft) setDraft(null); else onClose(); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    }
  }

  return <div className="mask-modal" role="dialog" aria-modal="true" aria-labelledby="annotations-title" onKeyDown={onKeyDown}>
    <div className="mask-header"><strong id="annotations-title">Annotate · {name}</strong><button ref={close} onClick={onClose}>Close</button></div>
    <div className="annotation-layout">
      <div className="mask-work"><canvas ref={canvas} aria-label="Captured specimen to annotate" onClick={place} onPointerMove={e => { if (draft && image && e.pointerType !== 'touch') setHover(coords(e)); }} onPointerLeave={() => setHover(null)} /></div>
      <div className="annotation-panel">
        <div className="table-buttons">{Object.entries(tools).map(([id, label]) => <button key={id} aria-pressed={tool === id} onClick={() => { setDraft(null); setSelected(null); setTool(id); }}>{label}</button>)}</div>
        <p className="quiet-note">{tool === 'outline' ? 'Click along the feature. Finish an open trace or close the boundary.' : tool === 'arrow' ? 'Click the tail and then the tip.' : 'Click the feature to place a numbered pin.'}</p>
        <div className="mask-controls">
          {tool === 'outline' && <><label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Magnetic edge snap</label>{snap && <label>Radius <input aria-label="Snap radius" type="range" min={4} max={32} value={radius} onChange={e => setRadius(Number(e.target.value))} /> {radius}px</label>}</>}
          <label>Color <input type="color" value={selectedMark?.color || style.color} onChange={e => selectedMark ? updateMark({ color: e.target.value }) : setStyle({ ...style, color: e.target.value })} /></label>
          <label>Width <input type="range" min={1} max={8} value={selectedMark?.width || style.width} onChange={e => selectedMark ? updateMark({ width: Number(e.target.value) }) : setStyle({ ...style, width: Number(e.target.value) })} /></label>
          {tool === 'outline' && <label><input type="checkbox" checked={selectedMark?.fill ?? style.fill} onChange={e => selectedMark ? updateMark({ fill: e.target.checked }) : setStyle({ ...style, fill: e.target.checked })} /> Tint outline</label>}
        </div>
        {tool === 'outline' && draft && <div className="table-buttons"><button disabled={draft.anchors.length < 2} onClick={() => finishDraft(false)}>Finish trace</button><button disabled={draft.anchors.length < 3} onClick={() => finishDraft(true)}>Close outline</button></div>}
        <div className="table-buttons"><button disabled={!draft && !past.length} onClick={undo}>Undo</button><button disabled={!!draft || !future.length} onClick={redo}>Redo</button></div>
        {!!marks.length && <label>Marks<select value={selected ?? ''} onChange={e => { setDraft(null); setSelected(e.target.value === '' ? null : Number(e.target.value)); }}><option value="">Choose a mark</option>{marks.map((mark, i) => <option value={i} key={i}>{i + 1}. {mark.text || tools[mark.type]}</option>)}</select></label>}
        {selectedMark && <div className="mark-details">
          <label>Label<input value={selectedMark.text} maxLength={80} onChange={e => updateMark({ text: e.target.value })} /></label>
          <label>Observation<textarea rows={2} value={selectedMark.notes} maxLength={4000} onChange={e => updateMark({ notes: e.target.value })} /></label>
          <label>Confidence<select value={selectedMark.confidence} onChange={e => updateMark({ confidence: e.target.value })}>{confidenceValues.map(value => <option key={value}>{value}</option>)}</select></label>
          <button className="secondary-button" onClick={() => { commit(marks.filter((_, i) => i !== selected)); setSelected(null); }}>Delete mark</button>
        </div>}
        <button className="primary-button full-width" disabled={!image || !marks.length || !!draft} onClick={exportImage}>Save annotated PNG</button>
        <button className="secondary-button full-width" disabled={!image || !marks.length || !!draft} onClick={exportProject}>Save editable project</button>
        {failure && <p role="alert" className="capture-error">{failure}</p>}
      </div>
    </div>
  </div>;
}
