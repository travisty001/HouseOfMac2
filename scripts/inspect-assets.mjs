#!/usr/bin/env node
// Independent QA oracle; this does not replace the application's import detector.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const gaussianProperties = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2',
  'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];

export function inspectGLB(bytes) {
  assert(bytes.length >= 20, 'Truncated GLB');
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', 'Missing real GLB magic');
  assert.equal(bytes.readUInt32LE(4), 2, 'Expected GLB version 2');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB declared length differs from actual bytes');
  let offset = 12;
  const chunks = [];
  while (offset < bytes.length) {
    assert(offset + 8 <= bytes.length, 'Truncated chunk header');
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    assert.equal(length % 4, 0, 'Chunk must be aligned');
    assert(offset + 8 + length <= bytes.length, 'Truncated chunk payload');
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  assert.equal(chunks[0]?.type, 0x4e4f534a, 'First chunk must be JSON');
  const gltf = JSON.parse(chunks[0].data.toString('utf8').trim());
  assert.equal(gltf.asset?.version, '2.0');
  assert(gltf.meshes?.length > 0, 'Sample must contain a mesh');
  assert(chunks.some(c => c.type === 0x004e4942 && c.data.length), 'Sample must contain binary payload');
  return { kind: 'mesh', bytes: bytes.length, meshes: gltf.meshes.length };
}

export function inspectPLY(bytes) {
  // Bound header scanning so a damaged file cannot decode the entire binary body.
  const prefix = bytes.subarray(0, 1024 * 1024).toString('latin1');
  assert(/^ply\r?\n/.test(prefix), 'Missing PLY magic');
  const end = /^end_header\r?\n/m.exec(prefix);
  assert(end, 'Missing or oversized PLY header');
  const header = prefix.slice(0, end.index);
  const format = /^format (ascii|binary_little_endian|binary_big_endian) 1\.0\r?$/m.exec(header)?.[1];
  assert(format, 'Unsupported PLY format');
  let element;
  let vertices;
  const properties = [];
  for (const line of header.split(/\r?\n/)) {
    const e = /^element (\S+) (\d+)$/.exec(line);
    if (e) { element = e[1]; if (element === 'vertex') vertices = Number(e[2]); }
    if (element === 'vertex' && line.startsWith('property ')) {
      const p = /^property (float|float32|double|float64|char|uchar|short|ushort|int|uint|int8|uint8|int16|uint16|int32|uint32) (\S+)$/.exec(line);
      assert(p, 'Unsupported vertex property');
      properties.push({ type: p[1], name: p[2] });
    }
  }
  assert(vertices > 0, 'No vertices');
  const names = new Set(properties.map(p => p.name));
  assert(['x', 'y', 'z'].every(p => names.has(p)), 'Missing positions');
  const bodyOffset = end.index + end[0].length;
  if (format !== 'ascii') {
    const sizes = { float: 4, float32: 4, double: 8, float64: 8, char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4 };
    assert(bytes.length - bodyOffset >= vertices * properties.reduce((n, p) => n + sizes[p.type], 0), 'Truncated vertex payload');
  } else {
    const rows = bytes.subarray(bodyOffset).toString('utf8').trim().split(/\r?\n/);
    assert(rows.length >= vertices, 'Truncated ASCII vertices');
    for (const row of rows.slice(0, vertices)) {
      const values = row.trim().split(/\s+/);
      assert.equal(values.length, properties.length, 'Wrong vertex field count');
      assert(values.every(v => Number.isFinite(Number(v))), 'Non-numeric vertex');
    }
  }
  return { kind: gaussianProperties.every(p => names.has(p)) ? 'splat' : 'points', format, vertices, properties: [...names] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../public/', import.meta.url);
  console.log(JSON.stringify({ glb: inspectGLB(await readFile(new URL('final.glb', root))),
    ply: inspectPLY(await readFile(new URL('3DGS.ply', root))) }, null, 2));
}
