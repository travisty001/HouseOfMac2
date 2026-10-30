import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bounded = (value, fallback, min, max) => THREE.MathUtils.clamp(finite(value, fallback), min, max);
const isFinitePoint = p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

// Percentages map linearly to bounded Three.js light strengths (100% key = 3).
export const lightingPresets = {
  studio: { label: 'Studio', lightMode: 'directional', lightAngle: 45, lightElevation: 40, lightIntensity: 100, ambientFill: 35, lightTemperature: 'neutral', secondaryFill: false },
  raking: { label: 'Raking', lightMode: 'directional', lightAngle: 80, lightElevation: 8, lightIntensity: 130, ambientFill: 8, lightTemperature: 'neutral', secondaryFill: false },
  cross: { label: 'Cross-light', lightMode: 'directional', lightAngle: 65, lightElevation: 25, lightIntensity: 100, ambientFill: 15, lightTemperature: 'neutral', secondaryFill: true },
  silhouette: { label: 'Silhouette', lightMode: 'backlight', lightAngle: 180, lightElevation: 0, lightIntensity: 130, ambientFill: 0, lightTemperature: 'neutral', secondaryFill: false },
  flat: { label: 'Flat', lightMode: 'flat', lightAngle: 45, lightElevation: 40, lightIntensity: 100, ambientFill: 100, lightTemperature: 'neutral', secondaryFill: false },
};

export function resolveLighting(settings = {}) {
  const preset = lightingPresets[settings.lightingPreset] || (settings.raking ? lightingPresets.raking : lightingPresets.studio);
  return { ...preset, ...Object.fromEntries(Object.keys(preset).filter(key => key !== 'label' && settings[key] !== undefined).map(key => [key, settings[key]])) };
}

// Ambient-only Lambert diffuse has no normal-dependent shading, even on metallic sources.
// Keep the original albedo, alpha and vertex colors; omit baked AO and emissive light.
function inspectionMaterial(source, flat = false) {
  if (!flat && !source.isMeshBasicMaterial) {
    const material = source.clone();
    if (material.emissive) material.emissive.set(0x000000);
    material.emissiveMap = null;
    material.lightMap = null;
    material.envMap = null;
    return material;
  }
  const material = flat ? new THREE.MeshLambertMaterial() : new THREE.MeshStandardMaterial({ roughness: .85 });
  for (const key of ['color', 'map', 'alphaMap', 'opacity', 'transparent', 'alphaTest', 'side', 'vertexColors', 'depthWrite', 'depthTest', 'wireframe', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits']) {
    if (source[key] !== undefined) material[key] = source[key]?.isColor ? source[key].clone() : source[key];
  }
  return material;
}

function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), bitmaps = new Set();
  root?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of [object.material, object.userData.originalMaterial, object.userData.clayMaterial, object.userData.wireMaterial, object.userData.litMaterial, object.userData.flatMaterials].flat(Infinity)) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) {
          textures.add(value);
          if (value.source?.data?.close) bitmaps.add(value.source.data);
        }
      }
    }
    object.skeleton?.dispose();
  });
  geometries.forEach(g => g.dispose());
  textures.forEach(t => t.dispose());
  materials.forEach(m => m.dispose());
  bitmaps.forEach(b => b.close());
}

export function createViewer(host, asset, latest, restore) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
  } catch (error) { throw new Error(`WebGL2 is required. ${error.message}`); }
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x191b1d, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
  canvas.setAttribute('aria-label', `${asset.kind} viewer: ${asset.name || 'local asset'}`);
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const perspective = new THREE.PerspectiveCamera(45, 1, .01, 1000);
  const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 1000);
  let camera = perspective;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = .12;
  controls.screenSpacePanning = true;
  const ambient = new THREE.AmbientLight(0xffffff, 1.05);
  const key = new THREE.DirectionalLight(0xfff1d9, 3);
  const secondary = new THREE.DirectionalLight(0xffffff, 0);
  scene.add(ambient, key, key.target, secondary, secondary.target);
  renderer.shadowMap.enabled = asset.kind === 'mesh';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -.0002;
  const lightDirection = new THREE.Vector3();
  const lightColor = new THREE.Color();
  let lighting = resolveLighting();

  function positionLights() {
    if (asset.kind !== 'mesh') return;
    const azimuth = THREE.MathUtils.degToRad(bounded(lighting.lightAngle, 45, 0, 360));
    const elevation = THREE.MathUtils.degToRad(bounded(lighting.lightElevation, 40, 0, 90));
    // View-relative axes keep the backlight behind the specimen as the camera orbits.
    lightDirection.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)).applyQuaternion(camera.quaternion);
    key.target.position.copy(center);
    key.position.copy(center).addScaledVector(lightDirection, radius * 3);
    secondary.target.position.copy(center);
    lightDirection.set(-Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation)).applyQuaternion(camera.quaternion);
    secondary.position.copy(center).addScaledVector(lightDirection, radius * 3);
  }
  const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  const center = new THREE.Vector3(), size = new THREE.Vector3();
  const abort = new AbortController();
  let root, splats, ready = false, dead = false, lost = false, frame = 0, radius = 1;
  let width = 1, height = 1, orthoHeight = 2, dirty = true, lastTime = 0, lastDraw = 0, lastNotify = 0;
  let lastCommandId, hasCommand = false, settings = {}, visible = true;
  const offset = new THREE.Vector3();
  const error = e => { if (!dead) latest.current.onError?.(e instanceof Error ? e.message : String(e)); };
  const changed = () => { dirty = true; };
  controls.addEventListener('change', changed);
  renderer.debug.onShaderError = (gl, program) => {
    ready = false;
    error(new Error(`The GPU could not compile this renderer: ${gl.getProgramInfoLog(program) || 'WebGL shader failure'}`));
  };

  function projection() {
    const aspect = width / height;
    perspective.aspect = aspect;
    orthographic.left = -orthoHeight * aspect / 2;
    orthographic.right = orthoHeight * aspect / 2;
    orthographic.top = orthoHeight / 2;
    orthographic.bottom = -orthoHeight / 2;
    perspective.updateProjectionMatrix();
    orthographic.updateProjectionMatrix();
    dirty = true;
  }
  function resize() {
    const rect = host.getBoundingClientRect();
    visible = rect.width > 0 && rect.height > 0;
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    projection();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  function fit(direction = new THREE.Vector3(1, .55, 1)) {
    const halfFov = THREE.MathUtils.degToRad(perspective.fov / 2);
    const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * width / height));
    const distance = radius / Math.sin(limitingFov) * 1.15;
    controls.target.copy(center);
    camera.up.set(0, 1, 0);
    if (Math.abs(direction.clone().normalize().y) > .99) camera.up.set(0, 0, direction.y > 0 ? -1 : 1);
    camera.position.copy(center).addScaledVector(direction.normalize(), distance);
    orthoHeight = radius * 2.3 / Math.min(1, width / height);
    camera.zoom = 1;
    for (const c of [perspective, orthographic]) {
      c.near = Math.max(radius / 10000, .00001);
      c.far = Math.max(radius * 100, 100);
    }
    controls.minDistance = radius * .01;
    controls.maxDistance = radius * 50;
    controls.minZoom = .02;
    controls.maxZoom = 100;
    camera.lookAt(center);
    projection();
    controls.update();
    dirty = true;
  }

  function applySettings() {
    if (dead) return;
    settings = latest.current.settings || {};
    const next = settings.orthographic && asset.kind === 'mesh' ? orthographic : perspective;
    if (camera !== next) {
      if (next.isOrthographicCamera) {
        orthoHeight = 2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));
        next.zoom = 1;
      } else {
        const distance = orthoHeight / camera.zoom / (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2)));
        offset.copy(camera.position).sub(controls.target).normalize().multiplyScalar(distance);
        next.position.copy(controls.target).add(offset);
      }
      if (next.isOrthographicCamera) next.position.copy(camera.position);
      next.quaternion.copy(camera.quaternion);
      next.up.copy(camera.up);
      camera = next;
      controls.object = camera;
      if (splats) splats.camera = camera;
      projection();
    }
    if (asset.kind === 'mesh') {
      lighting = resolveLighting(settings);
      const flat = lighting.lightMode === 'flat';
      const backlight = lighting.lightMode === 'backlight';
      root?.traverse(object => {
        if (!object.isMesh) return;
        const appearance = settings.appearance === 'clay' ? 1 : settings.appearance === 'wireframe' ? 2 : 0;
        object.material = flat ? object.userData.flatMaterials[appearance] : appearance === 1 ? object.userData.clayMaterial : appearance === 2 ? object.userData.wireMaterial : object.userData.litMaterial;
        object.castShadow = !flat;
        object.receiveShadow = !flat;
        for (const m of [object.material].flat()) {
          const clipping = !!settings.clipEnabled;
          if (!!m.clippingPlanes !== clipping) { m.clippingPlanes = clipping ? [plane] : null; m.needsUpdate = true; }
        }
      });
      plane.constant = center.x + bounded(settings.clipOffset, 0, -1, 1) * size.x / 2;
      lightColor.set(lighting.lightTemperature === 'warm' ? 0xffd4a3 : lighting.lightTemperature === 'cool' ? 0xc6ddff : 0xffffff);
      key.color.copy(lightColor);
      secondary.color.copy(lightColor);
      ambient.color.copy(lightColor);
      const strength = bounded(lighting.lightIntensity, 100, 0, 200) * .03;
      key.intensity = flat ? 0 : strength;
      secondary.intensity = !flat && !backlight && lighting.secondaryFill ? strength * .65 : 0;
      ambient.intensity = backlight ? 0 : bounded(lighting.ambientFill, 35, 0, 100) * .03;
      key.castShadow = !flat;
      key.shadow.camera.left = key.shadow.camera.bottom = -radius * 1.2;
      key.shadow.camera.right = key.shadow.camera.top = radius * 1.2;
      key.shadow.camera.near = radius * .01;
      key.shadow.camera.far = radius * 6;
      key.shadow.normalBias = radius * .001;
      key.shadow.camera.updateProjectionMatrix();
      renderer.setClearColor(backlight ? 0xdbe2e5 : 0x191b1d, 1);
      positionLights();
    }
    if (asset.kind === 'points' && root) root.material.size = bounded(settings.pointSize, 2, .1, 30);
    if (ready && splats?.splatMesh?.material) {
      splats.splatMesh.setSplatScale(bounded(settings.splatScale, 1, .05, 5));
      splats.splatMesh.setPointCloudModeEnabled(!!settings.pointCloud);
      splats.forceRenderNextFrame();
    }
    controls.update();
    dirty = true;
  }

  function command(cmd) {
    if (!ready || !cmd || (hasCommand && cmd.id === lastCommandId)) return;
    hasCommand = true;
    lastCommandId = cmd.id;
    const directions = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };
    if (cmd.action === 'reset' || cmd.action === 'fit') fit();
    else if (directions[cmd.action]) fit(new THREE.Vector3(...directions[cmd.action]));
    else if (cmd.action === 'step-left' || cmd.action === 'step-right') {
      offset.copy(camera.position).sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), (cmd.action === 'step-left' ? -1 : 1) * Math.PI / 12);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      controls.update();
      dirty = true;
    }
  }

  function draw() {
    positionLights();
    if (splats) {
      splats.update();
      if (dirty || splats.shouldRender()) splats.render();
      splats.renderNextFrame = false;
    } else renderer.render(scene, camera);
  }
  function tick(time) {
    if (dead) return;
    frame = requestAnimationFrame(tick);
    if (!ready || lost || !visible || document.hidden || time - lastDraw < 32) return;
    const delta = Math.min((time - lastTime) / 1000 || 0, .1);
    lastTime = time;
    lastDraw = time;
    if (settings.spin && asset.kind !== 'mesh') {
      offset.copy(camera.position).sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), delta * bounded(settings.speed, 1, -10, 10) * .3);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      dirty = true;
    }
    controls.update();
    const notify = dirty;
    try {
      if (dirty || splats) draw();
    } catch (e) {
      ready = false;
      error(new Error(`Rendering stopped: ${e.message}`));
      return;
    }
    if (notify && time - lastNotify > 100) {
      lastNotify = time;
      latest.current.onCameraChange?.({ position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(), zoom: camera.zoom, orthographic: camera.isOrthographicCamera === true });
    }
    dirty = false;
  }
  frame = requestAnimationFrame(tick);
  function contextLost(event) {
    event.preventDefault();
    lost = true;
    ready = false;
    error(new Error('WebGL context lost. Rendering is paused; the asset will reload when the GPU context returns.'));
  }
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', restore);

  async function load() {
    try {
      let vertices = 0, faces;
      const box = new THREE.Box3();
      if (asset.kind === 'splat') {
        const GS = await import('@mkkellogg/gaussian-splats-3d');
        if (dead) return;
        // Explicit format is essential for blob URLs, which have no extension.
        let extension = (asset.name || asset.url).split(/[?#]/)[0].split('.').pop().toLowerCase();
        if (!['ply', 'splat', 'ksplat'].includes(extension)) {
          const response = await fetch(asset.url, { signal: abort.signal, headers: { Range: 'bytes=0-4095' } });
          if (!response.ok) throw new Error(`Asset request failed (${response.status}).`);
          const reader = response.body.getReader();
          const { value } = await reader.read();
          await reader.cancel();
          extension = new TextDecoder().decode(value?.subarray(0, 4096)).startsWith('ply') ? 'ply' : 'splat';
        }
        if (dead) return;
        splats = new GS.Viewer({ rootElement: host, renderer, camera, threeScene: scene, selfDrivenMode: false, useBuiltInControls: false,
          sharedMemoryForWorkers: false, gpuAcceleratedSort: false, integerBasedSort: false, ignoreDevicePixelRatio: true,
          halfPrecisionCovariancesOnGPU: true, sphericalHarmonicsDegree: 0, inMemoryCompressionLevel: 1,
          freeIntermediateSplatData: true, sceneRevealMode: GS.SceneRevealMode.Instant, renderMode: GS.RenderMode.OnChange,
          maxScreenSpaceSplatSize: 512 });
        await splats.addSplatScene(asset.url, { format: extension === 'ply' ? GS.SceneFormat.Ply : extension === 'ksplat' ? GS.SceneFormat.KSplat : GS.SceneFormat.Splat,
          showLoadingUI: false, progressiveLoad: false, splatAlphaRemovalThreshold: 1 });
        if (dead) return;
        vertices = splats.splatMesh.getSplatCount();
        const point = new THREE.Vector3();
        for (let i = 0; i < vertices; i++) {
          splats.splatMesh.getSplatCenter(i, point, true);
          if (isFinitePoint(point)) box.expandByPoint(point);
        }
      } else {
        const response = await fetch(asset.url, { signal: abort.signal });
        if (!response.ok) throw new Error(`Asset request failed (${response.status}).`);
        const buffer = await response.arrayBuffer();
        if (dead) return;
        if (asset.kind === 'mesh') {
          const resourcePath = /^(blob:|data:)/.test(asset.url) ? document.baseURI : new URL('.', new URL(asset.url, document.baseURI)).href;
          const gltf = await new GLTFLoader().parseAsync(buffer, resourcePath);
          if (dead) { disposeObject(gltf.scene); return; }
          root = gltf.scene;
          faces = 0;
          root.traverse(object => {
            if (!object.isMesh) return;
            const geometry = object.geometry;
            vertices += geometry.attributes.position?.count || 0;
            faces += (geometry.index?.count || geometry.attributes.position?.count || 0) / 3;
            object.userData.originalMaterial = object.material;
            const mapMaterials = (material, transform) => Array.isArray(material) ? material.map(transform) : transform(material);
            object.userData.litMaterial = mapMaterials(object.material, material => inspectionMaterial(material));
            const makeMaterial = wireframe => new THREE.MeshStandardMaterial({ color: wireframe ? 0xc6a77a : 0xc9c5bb, roughness: .85, metalness: 0, wireframe, side: THREE.DoubleSide });
            object.userData.clayMaterial = makeMaterial(false);
            object.userData.wireMaterial = makeMaterial(true);
            object.userData.flatMaterials = [object.material, object.userData.clayMaterial, object.userData.wireMaterial].map(material => mapMaterials(material, source => inspectionMaterial(source, true)));
          });
          root.updateMatrixWorld(true);
          box.setFromObject(root);
        } else if (asset.kind === 'points') {
          const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 65536))).split('end_header')[0];
          if (/property\s+\w+\s+(f_dc_0|scale_0|rot_0|opacity)\b/.test(header)) throw new Error('This PLY contains Gaussian properties. Import it in SPLAT mode.');
          const geometry = new PLYLoader().parse(buffer);
          vertices = geometry.attributes.position?.count || 0;
          // A face-bearing PLY is still deliberately rendered as points in POINTS mode.
          geometry.setIndex(null);
          root = new THREE.Points(geometry, new THREE.PointsMaterial({ color: geometry.hasAttribute('color') ? 0xffffff : 0xd5c7ae, vertexColors: geometry.hasAttribute('color'), size: 2, sizeAttenuation: false }));
          geometry.computeBoundingBox();
          box.copy(geometry.boundingBox);
        } else throw new Error(`Unsupported asset kind: ${asset.kind}`);
        scene.add(root);
      }
      if (box.isEmpty() || !isFinitePoint(box.min) || !isFinitePoint(box.max) || !vertices) throw new Error('The asset has no finite renderable positions.');
      box.getCenter(center);
      box.getSize(size);
      radius = Math.max(size.length() / 2, .0001);
      ready = true;
      fit();
      applySettings();
      command(latest.current.cameraCommand);
      latest.current.onReady?.({ type: asset.kind, vertices, ...(faces !== undefined ? { faces: Math.floor(faces) } : {}),
        capabilities: { orbit: true, capture: true, cameraPresets: true, orthographic: asset.kind === 'mesh', clipping: asset.kind === 'mesh', lighting: asset.kind === 'mesh', raking: asset.kind === 'mesh', pointCloud: asset.kind === 'splat', splatScale: asset.kind === 'splat', pointSize: asset.kind === 'points', spin: asset.kind !== 'mesh', alphaThreshold: false } });
    } catch (e) {
      if (!dead && e.name !== 'AbortError') {
        error(e);
        dispose();
      }
    }
  }

  async function capture() {
    if (!ready || dead || lost) throw new Error('Wait for the asset to finish loading before capturing.');
    try {
      // Rendering immediately before readback avoids preserveDrawingBuffer's persistent GPU memory cost.
      dirty = true;
      draw();
      const dataURL = canvas.toDataURL('image/png');
      return dataURL;
    } catch (e) {
      const failure = new Error(`PNG capture failed. External textures must allow CORS. ${e.message}`);
      error(failure);
      throw failure;
    }
  }

  function dispose() {
    if (dead) return;
    dead = true;
    ready = false;
    abort.abort();
    cancelAnimationFrame(frame);
    observer.disconnect();
    controls.removeEventListener('change', changed);
    controls.dispose();
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.removeEventListener('webglcontextrestored', restore);
    disposeObject(root);
    key.shadow.dispose();
    scene.clear();
    canvas.remove();
    // Native disposal waits for any pending worker sort/download before releasing GPU resources.
    const finish = () => { renderer.dispose(); renderer.forceContextLoss(); };
    if (splats) Promise.resolve(splats.dispose()).catch(() => {}).finally(finish);
    else finish();
  }
  return { load, applySettings, command, capture, dispose };
}
