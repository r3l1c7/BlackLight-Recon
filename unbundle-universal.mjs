#!/usr/bin/env node
/**  Webpack-5 universal exploder  –  handles:
 *      • a = { 123:function(){…}, 124:(e,t)=>{…} }
 *      • Object.assign(a,{ 123:function(){…}, … })
 *      • a[123] = function(){…}      / arrow and wrapped-arrow variants
 *  Works on minified bundles with NO source-maps.
 */

import fs   from 'fs';
import path from 'path';

const file = process.argv[2];
if (!file) {
  console.error('usage: node unbundle-wp5-universal.mjs /full/path/bundle.js');
  process.exit(1);
}

const src = fs.readFileSync(file, 'utf8');

/* ───── 1️⃣  locate the module-map variable (  s.m = <var>  ) ─────────────── */
const mm = src.match(/\.m\s*=\s*([a-zA-Z_$][\w$]*)/);
if (!mm) { console.log(`SKIP ${file}  (no .m property)`); process.exit(0); }
const mapVar = mm[1];

/* store {id, startPos} so we can balance braces later */
const hits = [];

/* ───── 2️⃣  object-literal blocks (  { 123:function(){…}, … }  ) ─────────── */
const objRe = new RegExp(
  `(?:${mapVar}\\s*=|Object\\.assign\\s*\\(\\s*${mapVar}\\s*,)\\s*\\{`,
  'g'
);
while (true) {
  const m = objRe.exec(src);
  if (!m) break;
  let pos = objRe.lastIndex;      // we are right after the opening “{”
  let depth = 1;
  let bodyStart = pos;
  while (depth && pos < src.length) {
    const ch = src[pos++];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  const objBody = src.slice(bodyStart, pos - 1);
  /* find each   123:function(…){ … }   OR   123:(…)=>{ … }   inside objBody */
  const propRe = /(\d+)\s*:\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{/g;
  let p;
  while ((p = propRe.exec(objBody)) !== null) {
    hits.push({ id: p[1], abs: bodyStart + p.index + p[0].length - 1 });
  }
}

/* ───── 3️⃣  direct assignments  a[123] = function(){…} / arrow … ─────────── */
const assignRe = new RegExp(
  `${mapVar}\\s*\\[\\s*(\\d+)\\s*]\\s*=\\s*` +
  `(?:function\\s*\\([^)]*\\)\\s*\\{|\\([^)]*\\)\\s*=>\\s*\\{|\\(\\([^)]*\\)\\s*=>\\s*\\{)`,
  'g'
);
let asn;
while ((asn = assignRe.exec(src)) !== null) {
  hits.push({ id: asn[1], abs: assignRe.lastIndex - 1 });
}

/* ───── 4️⃣  balance braces for every hit to extract full module bodies ───── */
if (!hits.length) {
  console.log(`SKIP ${file}  (no module definitions found)`); process.exit(0);
}
const modules = [];
for (const { id, abs } of hits) {
  let pos   = abs + 1;   // we are right after the first “{”
  let depth = 1;
  while (depth && pos < src.length) {
    const ch = src[pos++];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  modules.push({ id, body: src.slice(abs + 1, pos - 1).trim() });
}

/* ───── 5️⃣  write them to    modules-wp5/<id>.js ─────────────────────────── */
const outDir = path.join(path.dirname(file), 'modules-wp5');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

for (const { id, body } of modules) {
  fs.writeFileSync(path.join(outDir, `${id}.js`), body + '\n', 'utf8');
}

console.log(`✓ extracted ${modules.length} modules → ${outDir}`);
