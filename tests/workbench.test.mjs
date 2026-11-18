import assert from 'node:assert/strict';
import test from 'node:test';
import { integrateRotation, shots } from '../src/engine/workbench.js';
import { makeEdgeMap, snapPoint, traceEdge, validateAnnotationProject } from '../src/engine/annotations.js';

test('turntable startup motion is independent of refresh rate', () => {
  const at = hz => {
    let speed = 0, travel = 0;
    for (let frame = 0; frame < hz; frame++) {
      const motion = integrateRotation(speed, 2, 1 / hz);
      speed = motion.speed;
      travel += motion.travel;
    }
    return { speed, travel };
  };
  for (const key of ['speed', 'travel']) {
    assert.ok(Math.abs(at(30)[key] - at(144)[key]) < 1e-10);
  }
});

test('the dorsal pair tilts exactly 30 degrees from directly above', () => {
  for (const id of ['dorsal-30-front', 'dorsal-30-rear']) {
    const [x, y, z] = shots[id].direction;
    assert.ok(Math.abs(Math.acos(y / Math.hypot(x, y, z)) - Math.PI / 6) < 1e-10);
  }
});

test('magnetic trace keeps both chosen anchors and handles a boundary with no valid pixels', () => {
  const map = makeEdgeMap({ width: 8, height: 8, data: new Uint8ClampedArray(256) });
  const start = { x: 0, y: 0 };
  const end = { x: 7, y: 0 };
  assert.deepEqual(snapPoint(start, map, 7), start);
  const trace = traceEdge(start, end, map, 4);
  assert.deepEqual(trace[0], start);
  assert.deepEqual(trace.at(-1), end);
  assert.ok(trace.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('annotation imports reject external images and malformed marks', () => {
  const valid = { version: 1, specimen: 'Test', image: 'data:image/png;base64,YQ==', marks: [] };
  assert.equal(validateAnnotationProject(valid), valid);
  assert.throws(() => validateAnnotationProject({ ...valid, image: 'https://example.com/image.png' }));
  assert.throws(() => validateAnnotationProject({ ...valid, marks: [{ type: 'pin', points: [{ x: 0, y: Infinity }] }] }));
});
