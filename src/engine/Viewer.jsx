import { useEffect, useRef, useState } from 'react';
import { createViewer } from './runtime.js';

/** One local WebGL context. The parent must provide a nonzero height. */
export default function Viewer({ asset, settings = {}, onReady, onError, onCameraChange, cameraCommand, captureRef }) {
  const host = useRef(null);
  const runtime = useRef(null);
  const latest = useRef({ settings, onReady, onError, onCameraChange, cameraCommand });
  latest.current = { settings, onReady, onError, onCameraChange, cameraCommand };
  const [generation, restart] = useState(0);

  useEffect(() => {
    if (!asset?.url || !host.current) return undefined;
    let instance;
    try {
      instance = createViewer(host.current, asset, latest, () => restart(n => n + 1));
      runtime.current = instance;
      instance.load();
    } catch (error) {
      latest.current.onError?.(`WebGL initialization failed: ${error.message}`);
    }
    return () => {
      runtime.current = null;
      instance?.dispose();
    };
  }, [asset?.url, asset?.kind, asset?.name, generation]);

  useEffect(() => { runtime.current?.applySettings(); }, [settings]);
  useEffect(() => { runtime.current?.command(cameraCommand); }, [cameraCommand]);
  useEffect(() => {
    if (!captureRef) return undefined;
    const capture = () => {
      if (!runtime.current) return Promise.reject(new Error('No asset is ready for capture.'));
      return runtime.current.capture();
    };
    captureRef.current = capture;
    return () => { if (captureRef.current === capture) captureRef.current = null; };
  }, [captureRef]);

  return <div ref={host} data-engine="viewer" style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', position: 'relative', background: '#191b1d' }} />;
}
