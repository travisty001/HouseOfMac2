#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gaussianProperties, inspectGLB, inspectPLY } from '../scripts/inspect-assets.mjs';

const ply = (properties, comment = '') => Buffer.from(`ply\nformat ascii 1.0\n${comment}element vertex 1\n${properties.map(p => `property float ${p}\n`).join('')}end_header\n${properties.map(() => '0').join(' ')}\n`);

test('real bundled GLB has binary magic, v2 framing, JSON mesh and BIN payload', async () => {
  const bytes = await readFile(new URL('../public/final.glb', import.meta.url));
  assert.equal(inspectGLB(bytes).kind, 'mesh');
  assert.throws(() => inspectGLB(bytes.subarray(0, bytes.length - 1)), /length/);
  assert.throws(() => inspectGLB(Buffer.from('<html>final.glb is not a GLB</html>')), /magic/);
});

test('real bundled Gaussian PLY has complete attributes and enough binary vertex bytes', async () => {
  const bytes = await readFile(new URL('../public/3DGS.ply', import.meta.url));
  const result = inspectPLY(bytes);
  assert.equal(result.kind, 'splat');
  assert.equal(result.format, 'binary_little_endian');
  assert(result.vertices > 0);
  for (const name of gaussianProperties) assert(result.properties.includes(name), name);
  assert.throws(() => inspectPLY(bytes.subarray(0, 4096)), /Truncated/);
});

test('ordinary colored PLY remains points even with Gaussian names in a comment', () => {
  assert.equal(inspectPLY(ply(['x', 'y', 'z', 'red', 'green', 'blue'], `comment ${gaussianProperties.join(' ')}\n`)).kind, 'points');
});

test('partial Gaussian properties do not imply a complete Gaussian schema', () => {
  for (const missing of gaussianProperties.filter(p => !['x', 'y', 'z'].includes(p))) {
    assert.equal(inspectPLY(ply(gaussianProperties.filter(p => p !== missing))).kind, 'points', missing);
  }
  assert.equal(inspectPLY(ply(gaussianProperties)).kind, 'splat');
});

test('properties on another element cannot turn vertices into Gaussians', () => {
  const bytes = ply(['x', 'y', 'z']).toString().replace('end_header', `element face 0\n${gaussianProperties.slice(3).map(p => `property float ${p}`).join('\n')}\nend_header`);
  assert.equal(inspectPLY(Buffer.from(bytes)).kind, 'points');
});

test('malformed PLY and HTML masquerading as PLY fail explicitly', () => {
  assert.throws(() => inspectPLY(Buffer.from('<html>3DGS.ply</html>')), /magic/);
  assert.throws(() => inspectPLY(Buffer.from('ply\nformat ascii 1.0\n')), /header/);
  assert.throws(() => inspectPLY(ply(['x', 'y'])), /positions/);
});
