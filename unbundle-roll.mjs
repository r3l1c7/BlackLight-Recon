#!/usr/bin/env node
/* unbundle-roll.mjs – splits bundles that contain // <stdin> / // src/foo.js markers */
import fs from "fs";
import path from "path";

const file = process.argv[2];
if (!file) process.exit(0);
const txt = fs.readFileSync(file, "utf8");
const parts = txt.split(/\/\/\s<[^>]+>\n/).filter(Boolean);
if (parts.length < 2) process.exit(0);      // not Roll/Vite

const outDir = path.join(path.dirname(file), "modules-roll");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
parts.forEach((code, idx) =>
  fs.writeFileSync(path.join(outDir, `${idx}.js`), code.trimStart(), "utf8")
);
console.log(`✓ ${parts.length} modules → ${outDir}`);
