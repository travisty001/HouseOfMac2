import { useRef, useState } from 'react';
import { Box, Camera, Check, Film, List, Pencil, StepBack, StepForward } from 'lucide-react';
import { shots } from './engine/workbench.js';

export function Toggle({ label, checked, onChange, detail }) {
  return <label className="toggle-row"><span>{label}{detail && <small>{detail}</small>}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="switch" /></label>;
}

export function Range({ label, value, onChange, min, max, step = 1, suffix = '' }) {
  return <label className="range-field"><span>{label}<output>{Number(value).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)}{suffix}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /></label>;
}

function Turntable({ current, update, command, canOrtho, position }) {
  const [targetAngle, setTargetAngle] = useState('0');
  return <section className="tool-section" aria-label="Turntable controls">
    <div className="section-title"><h2>Turntable</h2><output className="subtle-label" aria-label="Current turntable angle">{position.toFixed(1)}°</output></div>
    <div className="table-buttons">
      <button onClick={() => command('step-left')} aria-label="Step back 15 degrees"><StepBack size={16} /></button>
      <button onClick={() => update('spin', !current.spin)} aria-pressed={current.spin}>{current.spin ? 'Pause' : 'Play'}</button>
      <button onClick={() => command('step-right')} aria-label="Step forward 15 degrees"><StepForward size={16} /></button>
      <button onClick={() => command('zero')}>Home</button>
    </div>
    <div className="workbench-row">
      <label>Motion<select className="lighting-select" value={current.spinMode} onChange={e => update('spinMode', e.target.value)}><option value="continuous">Continuous</option><option value="sweep">Sweep</option></select></label>
      <label>Direction<select className="lighting-select" value={current.spinDirection} onChange={e => update('spinDirection', Number(e.target.value))}><option value={1}>Forward</option><option value={-1}>Reverse</option></select></label>
    </div>
    <Range label="Speed" min={.05} max={5} step={.05} value={current.speed} suffix="×" onChange={value => update('speed', value)} />
    {current.spinMode === 'sweep' && <Range label="Sweep arc" min={20} max={330} step={5} value={current.sweepDegrees} suffix="°" onChange={value => update('sweepDegrees', value)} />}
    <form className="angle-form" onSubmit={e => { e.preventDefault(); if (targetAngle.trim() && Number.isFinite(Number(targetAngle))) command('angle', Number(targetAngle)); }}>
      <label>Go to angle <input type="number" min="-360" max="360" step=".1" value={targetAngle} onChange={e => setTargetAngle(e.target.value)} />°</label><button>Go</button>
    </form>
    {canOrtho && <Toggle label="Orthographic camera" checked={current.orthographic} onChange={value => update('orthographic', value)} />}
  </section>;
}

export default function Workbench({ asset, bench, openScan, approve, approved, canApprove, current, update, command, position, canOrtho, lighting, surface, ready, capture, exportShots, openMask, openProject, video }) {
  const projectInput = useRef(null);
  const [selection, setSelection] = useState(['dorsal-30-front', 'dorsal-30-rear']);
  const [saving, setSaving] = useState(false);
  const runShots = async () => {
    setSaving(true);
    try { await exportShots(selection); }
    finally { setSaving(false); }
  };
  const locked = saving || video.active;
  return <>
    <section className="tool-section bench-section">
      <div className="section-title"><h2>On the bench</h2><span className="subtle-label">{bench.length} SCANS</span></div>
      <div className="bench-list">{bench.map(scan => <button key={scan.id} disabled={locked} className={asset?.id === scan.id ? 'selected' : ''} aria-pressed={asset?.id === scan.id} onClick={() => openScan(scan)} title={scan.name}><Box size={16} /><span>{scan.name.replace(/\.[^.]+$/, '')}</span></button>)}</div>
      {canApprove && <button className="secondary-button full-width" disabled={!ready || locked || approved} onClick={approve}><Check size={15} />{approved ? 'On the bench' : 'Pass scan & add to bench'}</button>}
    </section>
    {surface}
    <Turntable {...{ current, update, command, canOrtho, position }} />
    {lighting}
    <section className="tool-section">
      <div className="section-title"><h2>Shot list</h2><List size={15} /></div>
      <p className="quiet-note">Dorsal 30° is measured from straight above. Views use the scan’s imported axes.</p>
      <fieldset disabled={locked} className="shot-options">
        <div className="table-buttons"><button onClick={() => setSelection(Object.keys(shots))}>Full workup</button><button onClick={() => setSelection(['dorsal-30-front', 'dorsal-30-rear'])}>Dorsal pair</button></div>
        {Object.entries(shots).map(([id, shot]) => <div className="shot-row" key={id}><label><input type="checkbox" checked={selection.includes(id)} onChange={e => setSelection(e.target.checked ? [...selection, id] : selection.filter(value => value !== id))} />{shot.label}</label><button disabled={!ready} onClick={() => command(id)} aria-label={`Preview ${shot.label}`}>View</button></div>)}
      </fieldset>
      <button className="primary-button full-width" onClick={runShots} disabled={!ready || locked || !selection.length}><Camera size={16} />{saving ? 'Rendering shots…' : `Save ${selection.length || ''} selected ${selection.length === 1 ? 'shot' : 'shots'}`}</button>
      <button className="secondary-button full-width" disabled={!ready || locked} onClick={capture}>Save current view <kbd>S</kbd></button>
      <button className="secondary-button full-width" disabled={!ready || locked} onClick={openMask}><Pencil size={15} />Annotate current view</button>
      <input type="file" accept=".json,application/json" hidden ref={projectInput} onChange={e => { openProject(e.target.files[0]); e.target.value = ''; }} />
      <button className="secondary-button full-width" disabled={locked} onClick={() => projectInput.current.click()}>Open annotation project</button>
    </section>
    <section className="tool-section video-capture" aria-label="WebM video recording">
      <div className="section-title"><h2>Record video</h2><span className={`recording-timer ${video.active ? 'running' : ''}`} role="timer" aria-label="Recording elapsed time">{video.elapsed}</span></div>
      <label className="video-fps">Frame rate<select className="lighting-select" value={video.fps} disabled={locked} onChange={e => video.setFps(Number(e.target.value))}>{[15, 24, 30, 60].map(value => <option key={value} value={value}>{value} FPS</option>)}</select></label>
      <fieldset className="video-options" disabled={locked}><Toggle label="Auto-turntable" checked={video.autoTurntable} onChange={video.setAutoTurntable} /></fieldset>
      {video.active ? <button className="secondary-button full-width recording-stop" disabled={video.stopping} onClick={video.stop}>{video.stopping ? 'Finishing WebM…' : 'Stop & save WebM'}</button> : <button className="primary-button full-width" disabled={!ready || !video.supported || saving} onClick={video.start}><Film size={16} />Start WebM recording</button>}
      {!video.supported && <p className="capture-error">Canvas WebM recording is unavailable in this browser.</p>}
      {video.error && <p className="capture-error" role="alert">{video.error}</p>}
      <p className="quiet-note">Keep this tab visible while recording.</p>
    </section>
  </>;
}
