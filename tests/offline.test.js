import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('service worker cacher alle filer appen trenger offline', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const needed = [...walk(join(root, 'app')), ...walk(join(root, 'lib')), ...walk(join(root, 'assets'))]
    .map((p) => `./${relative(root, p)}`)
    .filter((p) => !p.endsWith('.LICENSE'));
  for (const f of needed) assert.ok(sw.includes(`'${f}'`), `${f} mangler i sw.js`);
});

test('ingen eksterne CDN-adresser i appens filer', () => {
  const files = [join(root, 'index.html'), join(root, 'sw.js'), join(root, 'manifest.webmanifest'), ...walk(join(root, 'app'))];
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /(src|href)=["']https?:\/\/|import .* from ["']https?:\/\//, f);
});

test('publikumsskjermen formaterer aldri tider', () => {
  const src = readFileSync(join(root, 'app/ui/public.js'), 'utf8');
  assert.doesNotMatch(src, /formatCs|rank\(|determineWinner|bestTimes|computeStats/);
});
