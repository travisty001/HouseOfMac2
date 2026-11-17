import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Box, Camera, Check, Crosshair, FolderOpen, Image, Keyboard, Layers, MousePointer2, Move3D, Plus, RotateCcw, ScanLine, Settings2, Upload, X } from 'lucide-react';
import Viewer from './engine/Viewer';
import MaskEditor from './MaskEditor';
import { captureFilename, lightingPresets, recordingMimeType } from './engine/runtime.js';

const defaults = { appearance: 'original', lightingPreset: 'studio', ...lightingPresets.studio, clipEnabled: false, clipOffset: 0, pointSize: 2, splatScale: 1, pointCloud: false, spin: false, spinDirection: 1, speed: 0.3, orthographic: false };
const samples = [{ url: import.meta.env.BASE_URL + 'final.glb', name: 'Reference specimen.glb', kind: 'mesh', source: 'Included reference', sample: true }, { url: import.meta.env.BASE_URL + '3DGS.ply', name: 'Gaussian study.ply', kind: 'splat', source: 'Included reference', sample: true, previewScale: 3 }];
const kindLabel = { mesh: 'Mesh', splat: 'Gaussian splat', points: 'Point cloud' };
const bytes = n => n == null ? 'Reference asset' : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function IconButton({ icon: Icon, label, ...props }) { return <button className="icon-button" title={label} aria-label={label} {...props}><Icon size={17} strokeWidth={1.6} /></button>; }
function Toggle({ label, checked, onChange, detail }) { return <label className="toggle-row"><span>{label}{detail && <small>{detail}</small>}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="switch" /></label>; }
function Range({ label, value, onChange, min, max, step = 1, suffix = '' }) { return <label className="range-field"><span>{label}<output>{Number(value).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)}{suffix}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /></label>; }

function LightingRig({ settings, onChange }) {
  const custom = settings.lightingPreset === 'custom';
  const change = (key, value) => onChange({ [key]: value, lightingPreset: 'custom', raking: false });
  const selectPreset = value => onChange(value === 'custom' ? { lightingPreset: 'custom' } : { ...lightingPresets[value], lightingPreset: value, raking: false });
  const flat = settings.lightMode === 'flat', backlight = settings.lightMode === 'backlight';
  return <section className="tool-section lighting-rig" aria-label="Mesh lighting rig">
    <div className="section-title"><h2>Lighting rig</h2><span className="subtle-label">LIVE · MESH</span></div>
    <div className="lighting-preset-row"><select aria-label="Lighting preset" className="lighting-select" value={settings.lightingPreset} onChange={e => selectPreset(e.target.value)}>
      {Object.entries(lightingPresets).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}<option value="custom">Custom</option>
    </select>{!custom && <button className="lighting-adjust" onClick={() => selectPreset('custom')}>Adjust</button>}</div>
    <p className="lighting-description">{flat ? 'Uniform, shadowless diffuse inspection.' : backlight ? 'Backlight with zero front fill. Follows your view.' : settings.secondaryFill ? 'Opposing keys reveal detail from both sides.' : settings.lightingPreset === 'raking' ? 'Low grazing light reveals surface relief.' : 'Balanced key and ambient surface illumination.'}</p>
    {custom && <div className="lighting-advanced">
      <label className="lighting-mode">Distribution<select className="lighting-select" value={settings.lightMode} onChange={e => {
        const mode = e.target.value;
        onChange({ ...lightingPresets[mode === 'flat' ? 'flat' : mode === 'backlight' ? 'silhouette' : 'studio'], lightingPreset: 'custom' });
      }}><option value="directional">Directional</option><option value="flat">Shadowless flat</option><option value="backlight">Backlight</option></select></label>
      {!flat && <><Range label="Azimuth" value={settings.lightAngle} min={0} max={360} suffix="°" onChange={v => change('lightAngle', v)} />
        <Range label="Elevation" value={settings.lightElevation} min={0} max={90} suffix="°" onChange={v => change('lightElevation', v)} />
        <Range label="Key intensity" value={settings.lightIntensity} min={0} max={200} suffix="%" onChange={v => change('lightIntensity', v)} /></>}
      {!backlight && <Range label="Ambient fill" value={settings.ambientFill} min={0} max={100} suffix="%" onChange={v => change('ambientFill', v)} />}
      <div className="lighting-temperature"><span>Temperature</span><div className="segmented" role="group" aria-label="Light color temperature">{['warm', 'neutral', 'cool'].map(value => <button key={value} aria-pressed={settings.lightTemperature === value} className={settings.lightTemperature === value ? 'selected' : ''} onClick={() => change('lightTemperature', value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
      {!flat && !backlight && <Toggle label="Opposing fill" detail="Secondary directional light · 65% of key" checked={settings.secondaryFill} onChange={v => change('secondaryFill', v)} />}
    </div>}
    {settings.appearance === 'wireframe' && <p className="lighting-note">Wire shows lit edges only; use Neutral to inspect surface relief.</p>}
    {settings.appearance === 'original' && <p className="quiet-note">Captured texture may contain baked lighting. Use Neutral for relief.</p>}
  </section>;
}

async function readAsset(file, companions) {
  const ext = file.name.split('.').pop().toLowerCase();
  let kind;
  if (ext === 'ply') {
    const header = await file.slice(0, 131072).text();
    if (!/^ply\s/i.test(header) || !header.includes('end_header')) throw new Error('This PLY file has an invalid or unsupported header.');
    const properties = header.slice(0, header.indexOf('end_header'));
    kind = ['f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'].every(n => new RegExp('\\b' + n + '\\b').test(properties)) ? 'splat' : 'points';
  } else if (['splat', 'ksplat'].includes(ext)) kind = 'splat';
  else if (['glb', 'gltf'].includes(ext)) kind = 'mesh';
  else throw new Error('Choose a GLB, GLTF, PLY, SPLAT, or KSPLAT file.');
  const objectUrls = [];
  try {
    let blob = file;
    if (ext === 'gltf') {
      const document = JSON.parse(await file.text());
      for (const entry of [...(document.buffers || []), ...(document.images || [])]) {
        if (!entry.uri || entry.uri.startsWith('data:')) continue;
        const path = decodeURIComponent(entry.uri).replace(/^\.\//, '');
        const companion = companions.find(item => item.name === path || item.webkitRelativePath === path || item.name === path.split('/').pop());
        if (!companion) throw new Error(`Select the GLTF together with its resource “${path}”, or export a self-contained GLB.`);
        entry.uri = URL.createObjectURL(companion); objectUrls.push(entry.uri);
      }
      blob = new Blob([JSON.stringify(document)], { type: 'model/gltf+json' });
    }
    const url = URL.createObjectURL(blob); objectUrls.push(url);
    const originalUrl = ext === 'gltf' ? URL.createObjectURL(file) : url;
    if (originalUrl !== url) objectUrls.push(originalUrl);
    return { url, originalUrl, objectUrls, name: file.name, kind, size: file.size, source: 'Local file', importedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  } catch (error) { objectUrls.forEach(url => URL.revokeObjectURL(url)); throw error; }
}

export default function App() {
  const [assets, setAssets] = useState([samples[0], null]);
  const [settings, setSettings] = useState([{ ...defaults }, { ...defaults }]);
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState('Inspect');
  const [compare, setCompare] = useState(false);
  const [metadata, setMetadata] = useState([null, null]);
  const [ready, setReady] = useState([false, false]);
  const [errors, setErrors] = useState(['', '']);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [commands, setCommands] = useState([null, null]);
  const [maskSource,setMaskSource] = useState(null);
  const [fps, setFps] = useState(30);
  const [autoTurntable, setAutoTurntable] = useState(true);
  const [recording, setRecording] = useState({ status: 'idle', elapsed: 0 });
  const [recordingError, setRecordingError] = useState('');
  const recording0 = useRef(null), recording1 = useRef(null);
  const recordingRefs = [recording0, recording1];
  const previousActive = useRef(active);
  const videoSupported = !!recordingMimeType();
  const isRecording = recording.status !== 'idle';
  const elapsedSeconds = Math.floor(recording.elapsed / 1000);
  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  const inputRef = useRef(null);
  const capture0 = useRef(null), capture1 = useRef(null);
  const assetRef = useRef(assets);
  const targetRef = useRef(0);
  const sequence = useRef(0);
  const captureRefs = [capture0, capture1];
  const asset = assets[active], current = settings[active];
  const capabilities = metadata[active]?.capabilities || {};
  const canOrtho = asset?.kind === 'mesh' && capabilities.orthographic !== false;
  const canSpin = asset?.kind !== 'mesh' && capabilities.spin !== false;
  useEffect(() => {
    if (previousActive.current !== active) {
      (previousActive.current === 0 ? recording0 : recording1).current?.cancel();
      previousActive.current = active;
    }
  }, [active]);
  const onRecordingChange = useCallback(state => {
    setRecording(state);
    setRecordingError(state.error || '');
    if (state.saved) setNotice('WebM video saved locally.');
  }, []);
  const startRecording = () => {
    setRecordingError('');
    try {
      const api = recordingRefs[active].current;
      if (!api) throw new Error('Wait for the specimen to finish loading before recording.');
      api.start({ fps, turntable: autoTurntable });
    } catch (error) { setRecordingError(error.message); }
  };
  useEffect(() => {
    const live = new Set(assets.flatMap(a => a?.objectUrls || []));
    assetRef.current.flatMap(a => a?.objectUrls || []).forEach(url => { if (!live.has(url)) URL.revokeObjectURL(url); });
    assetRef.current = assets;
  }, [assets]);
  useEffect(() => () => assetRef.current.flatMap(a => a?.objectUrls || []).forEach(url => URL.revokeObjectURL(url)), []);
  const update = (key, value) => setSettings(previous => previous.map((s, i) => i === active ? { ...s, [key]: value } : s));
  const updateLighting = patch => setSettings(previous => previous.map((s, i) => i === active ? { ...s, ...patch } : s));
  const command = useCallback(action => setCommands(previous => previous.map((c, i) => i === active ? { id: ++sequence.current, action } : c)), [active]);
  const install = (next, slot = active) => {
    setAssets(previous => previous.map((a, i) => i === slot ? { ...next } : a));
    setSettings(previous => previous.map((s, i) => i === slot ? { ...defaults, splatScale: next.previewScale || 1 } : s));
    setMetadata(previous => previous.map((m, i) => i === slot ? null : m));
    setReady(previous => previous.map((r, i) => i === slot ? false : r));
    setErrors(previous => previous.map((e, i) => i === slot ? '' : e));
    setNotice(''); setActive(slot); setTab(compare ? 'Compare' : 'Inspect');
  };
  const importFiles = async (fileList, slot = targetRef.current) => {
    const files = Array.from(fileList || []); if (!files.length) return;
    const file = files.find(f => /\.(glb|gltf|ply|splat|ksplat)$/i.test(f.name));
    if (!file) { setNotice('Choose a GLB, GLTF, PLY, SPLAT, or KSPLAT file.'); return; }
    setBusy(true);
    try { const next = await readAsset(file, files); install(next, slot); setNotice(`Imported ${next.name}`); } catch (error) { setNotice(error.message); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };
  const chooseFile = (slot = active) => { targetRef.current = slot; inputRef.current?.click(); };
  const openMask = async () => {try {const handler=active===0?capture0.current:capture1.current;if(!handler)throw Error('Wait for renderer');setMaskSource(await handler());setTab('Capture')}catch(e){setNotice(e.message)}};
  const capture = useCallback(async () => {
    const handler = active === 0 ? capture0.current : capture1.current;
    if (!handler) { setNotice('Wait for the renderer to finish loading before capturing.'); return; }
    try {
      const dataURL = await handler();
      const link = document.createElement('a');
      link.href = dataURL;
      link.download = captureFilename(assets[active]?.name, 'png');
      document.body.appendChild(link);
      link.click();
      link.remove();
      setNotice('PNG capture saved.');
    } catch (error) { setNotice(`Capture failed: ${error.message}`); }
  }, [active, assets]);
  useEffect(() => {
    const listener = e => {
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 'f') command('reset');
      if (e.key.toLowerCase() === 's') { e.preventDefault(); capture(); }
      if (e.key === ' ' && canSpin) { e.preventDefault(); setSettings(previous => previous.map((s, i) => i === active ? { ...s, spin: !s.spin } : s)); }
      if (e.key === '1') command('front'); if (e.key === '3') command('right'); if (e.key === '7') command('top');
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [active, capture, command, canSpin]);
  const onReady = useCallback((slot, info) => { setMetadata(p => p.map((m, i) => i === slot ? info : m)); setReady(p => p.map((r, i) => i === slot ? true : r)); setErrors(p => p.map((e, i) => i === slot ? '' : e)); }, []);
  const onError = useCallback((slot, error) => { setErrors(p => p.map((e, i) => i === slot ? String(error) : e)); setReady(p => p.map((r, i) => i === slot ? false : r)); }, []);
  return <div className={`app-shell ${busy ? 'is-importing' : ''}`}>
    {maskSource && <MaskEditor source={maskSource} name={assets[active]?.name} onClose={()=>setMaskSource(null)}/>}
    <input ref={inputRef} type="file" multiple accept=".glb,.gltf,.ply,.splat,.ksplat,.bin,.png,.jpg,.jpeg,.webp,.ktx2" hidden onChange={e => importFiles(e.target.files)} />
    <header className="app-header">
      <a className="brand" href="#" onClick={e => e.preventDefault()} aria-label="House of Mac home"><span className="brand-symbol"><Box size={23} strokeWidth={1.4} /></span><span>HOUSE OF MAC<span className="brand-version">2.0 / FIELD STUDIO</span></span></a>
      <nav aria-label="Workspace">{[{ label: 'Import', icon: FolderOpen }, { label: 'Inspect', icon: ScanLine }, { label: 'Compare', icon: ArrowLeftRight }, { label: 'Capture', icon: Camera }].map(({ label, icon: Icon }) => <button key={label} className={tab === label ? 'nav-item selected' : 'nav-item'} onClick={() => setTab(label)}><Icon size={16} /><span>{label}</span></button>)}</nav>
      <button className="header-import" onClick={() => chooseFile()} disabled={busy}><Plus size={16} /><span>{busy ? 'Reading…' : 'Import file'}</span></button>
    </header>
    <div className="workspace">
      <main className={`stage ${compare ? 'is-comparing' : ''} ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); importFiles(e.dataTransfer.files, active); }}>
        <div className="stage-heading"><span className="eyebrow">{compare ? 'COMPARISON WORKSPACE' : 'SPECIMEN WORKSPACE'}</span><span className="local-indicator"><span /> Local session</span></div>
        <div className="viewports">{(compare ? [0, 1] : [active]).map(slot => <section key={slot} className={`viewport ${active === slot ? 'active-view' : ''}`} onPointerDown={() => setActive(slot)} aria-label={`Viewport ${slot + 1}`}>
          {assets[slot] ? <>
            <div className="viewport-label"><span className="view-index">{String(slot + 1).padStart(2, '0')}</span><span>{assets[slot].name}</span><span className="type-label">{kindLabel[assets[slot].kind]}</span></div>
            <div className="renderer"><Viewer key={assets[slot].url} asset={assets[slot]} settings={settings[slot]} cameraCommand={commands[slot]} captureRef={captureRefs[slot]} recordingRef={recordingRefs[slot]} onRecordingChange={onRecordingChange} onReady={info => onReady(slot, info)} onError={error => onError(slot, error)} /></div>
            {!ready[slot] && !errors[slot] && <div className="loading-overlay"><span className="loading-line" />Preparing specimen</div>}
            {errors[slot] && <div className="viewer-error"><Box size={25} /><strong>Unable to render this file</strong><p>{errors[slot]}</p><button onClick={() => chooseFile(slot)}>Choose another file</button></div>}
            <div className="viewport-bottom"><span>{settings[slot].orthographic && assets[slot].kind === 'mesh' ? 'ORTHOGRAPHIC' : 'PERSPECTIVE'}</span><span>{settings[slot].spin ? 'TURNTABLE ACTIVE' : 'ORBIT / FREE'}</span></div>
          </> : <div className="empty-view"><div className="empty-icon"><Plus size={25} strokeWidth={1} /></div><h2>A second perspective.</h2><p>Open another scan to compare geometry,<br />surface detail, or capture methods.</p><button className="primary-button" onClick={() => chooseFile(slot)}><FolderOpen size={16} />Import comparison</button><button className="text-button" onClick={() => install(samples[1], slot)}>Use Gaussian reference <ArrowUpRight size={14} /></button></div>}
        </section>)}</div>
        {dragging && <div className="drop-overlay"><Upload size={30} /><strong>Drop to inspect</strong><span>Your original stays on this device.</span></div>}
        <div className="stage-toolbar"><div><IconButton icon={Crosshair} label="Fit specimen (F)" onClick={() => command('reset')} /><IconButton icon={RotateCcw} label="Rotate camera left" onClick={() => command('step-left')} />{canOrtho && <IconButton icon={Move3D} label={current.orthographic ? 'Use perspective projection' : 'Use orthographic projection'} aria-pressed={current.orthographic} onClick={() => update('orthographic', !current.orthographic)} />}</div>{canSpin && <><span className="toolbar-divider" /><button className={`toolbar-spin ${current.spin ? 'on' : ''}`} onClick={() => update('spin', !current.spin)} aria-pressed={current.spin} title="Turntable (Space)"><span className="spin-indicator" />Turntable</button></>}<span className="toolbar-divider" /><IconButton icon={Camera} label="Save PNG (S)" onClick={capture} disabled={!ready[active]} /></div>
        <div className="navigation-hint"><MousePointer2 size={12} /><span>Drag to orbit<span className="hint-extra"> · Right-drag to pan · Scroll to zoom</span></span></div>
      </main>
      <aside className="tool-panel" aria-label={`${tab} tools`}>
        <div className="panel-heading"><span className="eyebrow">{tab === 'Inspect' ? 'INSPECTION TOOLS' : `${tab.toUpperCase()} WORKSPACE`}</span><Settings2 size={15} /></div>
        <div className="panel-content">
          {tab === 'Import' ? <>
            <div className="section-intro"><h1>Bring a scan into focus.</h1><p>Open an original capture. Inspect it locally with tools matched to its format.</p></div>
            <button className="import-zone" onClick={() => chooseFile()} disabled={busy}><Upload size={23} strokeWidth={1.3} /><strong>{busy ? 'Reading file…' : 'Choose a scan'}</strong><span>or drop a file into the viewport</span><small>GLB · GLTF · PLY · SPLAT · KSPLAT</small></button>
            <section className="tool-section"><h2>Reference files</h2>{samples.map(s => <button className="sample-button" key={s.kind} onClick={() => install(s)}><span className="sample-icon">{s.kind === 'mesh' ? <Box size={19} /> : <Layers size={19} />}</span><span><strong>{s.kind === 'mesh' ? 'Mesh specimen' : 'Gaussian study'}</strong><small>{s.kind === 'mesh' ? 'GLB / textured geometry' : 'PLY / 3D Gaussian splat'}</small></span><ArrowUpRight size={15} /></button>)}</section>
            <section className="tool-section kiri-section"><div className="section-title"><h2>KIRI Engine</h2><span className="subtle-label">EXPORT WORKFLOW</span></div><p>Export a Gaussian PLY or mesh from KIRI Engine, then open the downloaded file here.</p><a className="external-link" href="https://www.kiriengine.app/" target="_blank" rel="noreferrer">Open KIRI Engine <ArrowUpRight size={14} /></a><span className="quiet-note">Account connection is not configured.</span></section>
          </> : tab === 'Compare' ? <>
            <div className="section-intro"><h1>Read the differences.</h1><p>Two captures, one workspace. Select a viewport to adjust its tools.</p></div>
            <Toggle label="Split view" checked={compare} onChange={value => { setCompare(value); if (!value) setActive(0); }} />
            <section className="tool-section"><h2>Comparison files</h2>{[0, 1].map(slot => <div className={`comparison-file ${active === slot ? 'focused' : ''}`} key={slot}><button onClick={() => { if (slot === 1) setCompare(true); setActive(slot); }}><span className="view-index">0{slot + 1}</span><span><strong>{assets[slot]?.name || 'No file selected'}</strong><small>{assets[slot] ? kindLabel[assets[slot].kind] : 'Add a second capture'}</small></span></button><IconButton icon={assets[slot] ? FolderOpen : Plus} label={`Import view ${slot + 1}`} onClick={() => { setCompare(true); chooseFile(slot); }} /></div>)}</section>
            <p className="info-note">Cameras are independent. Each view preserves its own display settings; scale and alignment are not assumed.</p>
            <button className="secondary-button full-width" onClick={() => setTab('Inspect')}><Settings2 size={15} />Inspect selected view</button>
          </> : tab === 'Capture' ? <>
            <div className="section-intro"><h1>Keep the observation.</h1><p>Save the selected viewport at its current rendering resolution.</p></div>
            <div className="capture-summary"><Image size={28} strokeWidth={1.2} /><span>PNG image<small>{compare ? `Viewport 0${active + 1}` : 'Current viewport'} · Current camera</small></span></div>
            <button className="primary-button full-width" disabled={!ready[active]} onClick={capture}><ArrowDownToLine size={16} />Save screenshot<kbd>S</kbd></button>
            <button className="secondary-button full-width" disabled={!ready[active]} onClick={openMask}>Magnetic outline / annotation mask</button>
            <section className="tool-section" aria-label="Turntable controls"><h2>Turntable · live preview</h2><Toggle label="Rotate model" checked={current.spin} onChange={v => update('spin',v)} /><div className="segmented" role="group" aria-label="Turntable direction"><button className={current.spinDirection===-1 ? 'selected' : ''} onClick={()=>update('spinDirection',-1)}>Reverse</button><button className={current.spinDirection===1 ? 'selected' : ''} onClick={()=>update('spinDirection',1)}>Forward</button></div><Range label="Rotation speed" min={0.05} max={1} step={0.05} value={current.speed} onChange={v=>update('speed',v)} /><button className="secondary-button full-width" onClick={()=>update('spin',false)}>Pause rotation</button><p className="quiet-note">Works without recording. Speed and direction remain adjustable during recording.</p></section>
            <section className="tool-section video-capture" aria-label="WebM video recording">
              <div className="section-title"><h2>WebM video</h2><span className={`recording-timer ${isRecording ? 'running' : ''}`} role="timer" aria-label="Recording elapsed time">{elapsedLabel}</span></div>
              <label className="video-fps">Frame rate<select className="lighting-select" value={fps} disabled={isRecording} onChange={e => setFps(Number(e.target.value))}>{[15, 24, 30].map(value => <option key={value} value={value}>{value} FPS</option>)}</select></label>
              <fieldset className="video-options" disabled={isRecording}><Toggle label="Auto-turntable" checked={autoTurntable} onChange={setAutoTurntable} /></fieldset>
              
              {isRecording ? <button className="secondary-button full-width recording-stop" disabled={recording.status === 'stopping'} onClick={() => recordingRefs[active].current?.stop()}>{recording.status === 'stopping' ? 'Finishing WebM…' : 'Stop & save WebM'}</button> : <button className="primary-button full-width" disabled={!ready[active] || !videoSupported} onClick={startRecording}>Start WebM recording</button>}
              {!videoSupported && <p className="capture-error" role="alert">This browser does not support canvas recording with WebM. Try a browser with MediaRecorder and WebM support.</p>}
              {recordingError && <p className="capture-error" role="alert">{recordingError}</p>}
              <p className="quiet-note">Local recording only · No upload. Keep this tab visible while recording. Changing specimens or viewports cancels the recording.</p>
            </section>
            <section className="tool-section"><h2>Frame the specimen</h2><CameraViews command={command} />{canOrtho && <Toggle label="Orthographic" checked={current.orthographic} onChange={v => update('orthographic', v)} />}{canSpin && <Toggle label="Turntable" checked={current.spin} onChange={v => update('spin', v)} />}</section>
            <p className="info-note">The image records the rendered view. Original geometry and source files are never modified.</p>
          </> : <>
            <div className="asset-summary"><div className="section-title"><span className="mode-tag">{kindLabel[asset?.kind] || 'No asset'}</span><span className="subtle-label">VIEW 0{active + 1}</span></div><h1 title={asset?.name}>{asset?.name || 'Open a specimen'}</h1><span className="asset-meta">{bytes(asset?.size)}<span>·</span>{asset?.source}</span></div>
            {asset && <>
              <section className="tool-section"><h2>Surface display</h2>{asset.kind === 'mesh' ? <><div className="segmented">{[['original', 'Texture'], ['clay', 'Neutral'], ['wireframe', 'Wire']].map(([value, label]) => <button key={value} aria-pressed={current.appearance === value} className={current.appearance === value ? 'selected' : ''} onClick={() => update('appearance', value)}>{label}</button>)}</div></> : asset.kind === 'splat' ? <><Toggle label="Point cloud" detail="Inspect Gaussian centers" checked={current.pointCloud} onChange={v => update('pointCloud', v)} /><Range label="Splat scale" min={0.1} max={5} step={0.05} value={current.splatScale} suffix="×" onChange={v => update('splatScale', v)} /></> : <Range label="Point size" min={0.1} max={20} step={0.1} suffix=" px" value={current.pointSize} onChange={v => update('pointSize', v)} />}</section>
              {asset.kind === 'mesh' && <LightingRig settings={current} onChange={updateLighting} />}
              <section className="tool-section"><div className="section-title"><h2>Camera</h2><button className="inline-action" onClick={() => command('reset')}>Fit <kbd>F</kbd></button></div><CameraViews command={command} />{canOrtho && <Toggle label="Orthographic" checked={current.orthographic} onChange={v => update('orthographic', v)} />}{<Toggle label="Turntable" checked={current.spin} onChange={v => update('spin', v)} />}{current.spin && <Range label="Rotation speed" min={0.05} max={1} step={0.05} value={current.speed} onChange={v => update('speed', v)} />}</section>
              {asset.kind === 'mesh' && <section className="tool-section"><h2>Section plane</h2><Toggle label="Clip geometry" checked={current.clipEnabled} onChange={v => update('clipEnabled', v)} />{current.clipEnabled && <Range label="Plane offset" min={-1} max={1} step={0.01} value={current.clipOffset} onChange={v => update('clipOffset', v)} />}</section>}
              <section className="tool-section provenance"><h2>Source & integrity</h2><dl><div><dt>Source</dt><dd>{asset.sample ? asset.source : <select aria-label="File provenance" className="source-select" value={asset.source} onChange={e => setAssets(previous => previous.map((a, i) => i === active ? { ...a, source: e.target.value } : a))}><option>Local file</option><option>KIRI Engine export</option></select>}</dd></div><div><dt>Format</dt><dd>{asset.name.split('.').pop().toUpperCase()}</dd></div>{metadata[active]?.vertices != null && <div><dt>{asset.kind === 'mesh' ? 'Vertices' : 'Points'}</dt><dd>{Number(metadata[active].vertices).toLocaleString()}</dd></div>}{metadata[active]?.faces != null && <div><dt>Faces</dt><dd>{Number(metadata[active].faces).toLocaleString()}</dd></div>}</dl><p><Check size={12} />Original file preserved</p><a className="original-download" href={asset.originalUrl || asset.url} download={asset.name}><ArrowDownToLine size={12} />Download original</a><span className="quiet-note">Uncalibrated capture. Physical dimensions cannot be inferred.</span></section>
            </>}
          </>}
        </div>
        <div className="panel-footer"><Keyboard size={13} className="keyboard-symbol" /><span><kbd>F</kbd> fit{canSpin && <><span className="shortcut-gap" /><kbd>Space</kbd> spin</>}<span className="shortcut-gap" /><kbd>S</kbd> save</span></div>
      </aside>
    </div>
    <footer className="status-bar"><span className="status-message" role="status"><span className={`status-dot ${errors[active] ? 'error' : busy || !ready[active] ? 'working' : 'ready'}`} />{busy ? 'Reading local file…' : errors[active] ? 'Renderer needs attention' : ready[active] ? 'Ready to inspect' : 'Preparing viewport'}</span><span className="status-center">{asset ? kindLabel[asset.kind] : 'No specimen'}<span className="status-separator">/</span>NON-DESTRUCTIVE SESSION</span><span className="status-right">HOUSE OF MAC <span className="status-separator">/</span> 02</span></footer>
    {notice && <div className="toast" role="status"><span>{notice}</span><IconButton icon={X} label="Dismiss notification" onClick={() => setNotice('')} /></div>}
  </div>;
}
function CameraViews({ command }) { return <div className="camera-views">{['front', 'back', 'left', 'right', 'top', 'bottom'].map(view => <button key={view} onClick={() => command(view)}>{view[0].toUpperCase() + view.slice(1)}</button>)}</div>; }
