#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8766';
const output = resolve(process.env.SMOKE_OUTPUT || join(tmpdir(), 'house-of-mac-smoke'));
const timeout = Number(process.env.SMOKE_TIMEOUT || 90000);

async function loadPuppeteer() {
  if (process.env.PUPPETEER_MODULE) return (await import(pathToFileURL(resolve(process.env.PUPPETEER_MODULE)).href)).default;
  try { return (await import('puppeteer')).default; } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  const cache = join(homedir(), '.npm', '_npx');
  for (const entry of (await readdir(cache).catch(() => [])).sort()) {
    try {
      const require = createRequire(join(cache, entry, 'package.json'));
      return (await import(pathToFileURL(require.resolve('puppeteer')).href)).default;
    }
    catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Puppeteer unavailable locally or in ~/.npm/_npx. No packages were installed. Set PUPPETEER_MODULE to an existing ESM entry file.');
}

async function clickContext(page, label) {
  return page.evaluate(label => {
    const aliases = { File: ['file', 'import'], Analyze: ['analyze', 'inspect'], Compare: ['compare'], Capture: ['capture', 'workbench'] }[label] || [label.toLowerCase()];
    const el = [...document.querySelectorAll('button,[role="tab"]')].find(el =>
      (aliases.includes(el.textContent.trim().toLowerCase()) || aliases.includes(el.getAttribute('aria-label')?.toLowerCase())) && !el.disabled);
    if (!el) return false;
    el.click(); return true;
  }, label);
}

await mkdir(output, { recursive: true });
const report = { baseURL, started: new Date().toISOString(), checks: [], limitations: [
  'Mode labels and nonzero canvas bounds do not prove correct Gaussian rendering. Review screenshots on actual GPU hardware.',
  'Screenshot export, calibrated measurements, comparison synchronization, camera cleanup and original-file downloads require the manual QA checklist.',
] };
let browser;
try {
  const puppeteer = await loadPuppeteer();
  browser = await puppeteer.launch({ headless: process.env.HEADED !== '1',
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--enable-webgl', '--enable-unsafe-swiftshader', ...(process.env.NO_SANDBOX === '1' ? ['--no-sandbox'] : [])] });
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    page.setDefaultTimeout(timeout);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`${request.failure()?.errorText} ${request.url()}`); });
    try {
      const response = await page.goto(baseURL, { waitUntil: 'networkidle2' });
      assert(response?.ok(), `App returned HTTP ${response?.status()}`);
      await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0);
      for (const [file, kind] of [['public/final.glb', 'mesh'], ['public/3DGS.ply', 'splat'], ['tests/fixtures/points.ply', 'points']]) {
        await clickContext(page, 'File');
        const input = await page.waitForSelector('input[type="file"]');
        await input.uploadFile(join(root, file));
        const name = file.split('/').at(-1);
        await page.waitForFunction((name, kind) => {
          const text = document.body.innerText;
          const mode = { mesh: /\bmesh\b/i, splat: /\b(?:gaussian )?splat\b/i, points: /\bpoints\b|\bpoint cloud\b/i }[kind];
          const canvas = [...document.querySelectorAll('canvas')].some(c => c.width > 0 && c.height > 0 && c.getBoundingClientRect().width > 0);
          return text.includes(name) && mode.test(text) && canvas && !document.querySelector('.loading-overlay,.viewer-error,[aria-busy="true"]') && !/\bloading\b|\bprocessing\b|preparing specimen/i.test(text);
        }, {}, name, kind);
        for (const label of ['Analyze', 'Compare', 'Capture', 'File']) {
          assert(await clickContext(page, label), `Missing enabled ${label} context`);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }));
          assert(overflow.x <= 2 && overflow.y <= 2, `${label}: primary page scrolls (${JSON.stringify(overflow)})`);
        }
        const screenshot = join(output, `${viewport.width}-${kind}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        report.checks.push({ viewport, file, kind, screenshot, result: 'pass' });
      }
      assert.equal(errors.length, 0, `Browser errors:\n${errors.join('\n')}`);
    } catch (error) {
      await page.screenshot({ path: join(output, `${viewport.width}-failure.png`), fullPage: true }).catch(() => {});
      report.checks.push({ viewport, result: 'fail', error: error.message, browserErrors: errors });
      throw error;
    } finally { await page.close(); }
  }
  console.log(`PASS: ${report.checks.length} import/viewport checks. Evidence: ${output}`);
} catch (error) {
  report.error = error.message;
  console.error(`FAIL: ${error.message}\nEvidence: ${output}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
}
