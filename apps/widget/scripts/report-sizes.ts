/**
 * What the widget weighs, file by file, raw and gzipped.
 *
 * Printed at the end of every build and written to `dist/SIZES.md`, because
 * the loader's size is a promise made to stores and a promise is worth
 * measuring every time rather than asserting once.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(here, '../dist');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1).padStart(7)} KB`;

interface Row {
  file: string;
  raw: number;
  gz: number;
  group: string;
}

const rows: Row[] = walk(dist)
  .filter((file) => !file.endsWith('.map') && !file.endsWith('SIZES.md'))
  .map((file) => {
    const bytes = readFileSync(file);
    const name = relative(dist, file).replace(/\\/g, '/');
    const group = name === 'fitpath.js'
      ? 'button (the script tag)'
      : name === 'modal.js' || name.startsWith('chunks/modal')
        ? 'modal (on first press)'
        : name.startsWith('chunks/three') || name.startsWith('chunks/scene')
          ? '3D view (when there is a maneuver to draw)'
          : name.endsWith('.paths.json')
            ? 'motions (with the 3D view)'
            : name.startsWith('data/')
              ? 'product data (on first press, one product)'
              : 'other';
    return { file: name, raw: bytes.length, gz: gzipSync(bytes, { level: 9 }).length, group };
  })
  .sort((a, b) => a.group.localeCompare(b.group) || a.file.localeCompare(b.file));

const lines: string[] = ['# What the widget weighs', '', '| file | raw | gzip | loaded |', '| --- | ---: | ---: | --- |'];
for (const row of rows) lines.push(`| \`${row.file}\` | ${kb(row.raw).trim()} | ${kb(row.gz).trim()} | ${row.group} |`);

const groups = new Map<string, { raw: number; gz: number }>();
for (const row of rows) {
  const g = groups.get(row.group) ?? { raw: 0, gz: 0 };
  g.raw += row.raw;
  g.gz += row.gz;
  groups.set(row.group, g);
}
lines.push('', '| loaded | raw | gzip |', '| --- | ---: | ---: |');
for (const [group, sum] of groups) lines.push(`| ${group} | ${kb(sum.raw).trim()} | ${kb(sum.gz).trim()} |`);
lines.push('', 'Product data and motions are per product; the totals above add all six.');

writeFileSync(join(dist, 'SIZES.md'), `${lines.join('\n')}\n`);

console.log('\nwhat the widget weighs (raw / gzip):');
for (const row of rows.filter((r) => !r.file.startsWith('data/'))) {
  console.log(`  ${row.file.padEnd(34)} ${kb(row.raw)} / ${kb(row.gz)}   ${row.group}`);
}
for (const [group, sum] of groups) {
  console.log(`  ${('= ' + group).padEnd(48)} ${kb(sum.raw)} / ${kb(sum.gz)}`);
}
