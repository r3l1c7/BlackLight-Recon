/**
 * smart-rename.mjs · v3.0 · 2025-04-30
 * E S M  ―  run with:  node smart-rename.mjs <files…> [flags]
 *
 * Changes since v2.4
 * ───────────────────────────────────────────────────────────────────────────
 * • Pure ESM (file name *.mjs, no CommonJS require in caller)
 * • Per-file rename tracking → small .d.ts stubs
 * • One ESLint instance, reused across files  (--lint / --lint-dry)
 * • --prune  trims unused entries out of --map JSON
 * • Object-literal CommonJS export detection  (module.exports = { a(){} … })
 * • Default-import / export default propagation
 * • Granular progress (hidden in --review) + per-file counts
 * • --format-dry  / --lint-dry  run but don’t save changes unless --review
 */

import fs from "fs";
import path from "path";
import * as t from "@babel/types";
import parser from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import chalk from "chalk";
import { SingleBar, Presets } from "cli-progress";
import { createPatch } from "diff";
import process from "process";

/* lazy-load prettier / eslint only if needed */
let prettier = null;
let ESLint   = null;
async function getPrettier() { prettier ??= await import("prettier"); return prettier; }
async function getESLint()  { ESLint   ??= (await import("eslint")).ESLint; return ESLint; }

/* fastText mini model (optional) */
let ftModel = null;
try {
  const { loadModel } = await import("fasttext-lite");
  ftModel = await loadModel(new URL("./mini.ftz", import.meta.url).pathname);
} catch {/* semantic fallback disabled if model missing */}
const labelVecs = ftModel ? {} : null;

////////////////////////////////////////////////////////////////////////////////
// CLI flags
////////////////////////////////////////////////////////////////////////////////
const argv   = process.argv.slice(2);
const flags  = new Set(argv.filter(a=>a.startsWith("--")));

// only treat real JS files as “files” — skip flags, their values, directories, etc.
let files = argv.filter(arg => {
  if (arg.startsWith("--")) return false;
  try {
    const stat = fs.statSync(arg);
    // only keep real files ending in .js/.mjs
    return stat.isFile() && /\.(m?js)$/.test(arg);
  } catch {
    return false;
  }
});
if (!files.length) {
  console.error("usage: node smart-rename.mjs <file …> [flags]\n"
  + "  --out-dir dir      write outputs there (else in-place)\n"
  + "  --aggr             treat 2-3-char vars as minified\n"
  + "  --dict hints.json  merge extra heuristics\n"
  + "  --map  map.json    persist rename table (read+write)\n"
  + "  --prune            drop map entries not hit this run\n"
  + "  --review           diff only, don’t write\n"
  + "  --format | --format-dry   prettier format (dry keeps diff only)\n"
  + "  --lint   | --lint-dry     eslint --fix   (dry keeps diff only)\n"
  + "  --dts              write .d.ts stubs per renamed file\n"
  + "  --min-score N      default threshold\n"
  + "  --min-margin N     default margin");
  process.exit(1);
}
const getArg = (k,d)=>{const i=argv.indexOf(k);return i>-1?argv[i+1]:d;};
const OUT_DIR = flags.has("--out-dir") ? getArg("--out-dir") : null;
const AGGR    = flags.has("--aggr");
const REVIEW  = flags.has("--review");
const FORMAT  = flags.has("--format") || flags.has("--format-dry");
const LINT    = flags.has("--lint")   || flags.has("--lint-dry");
const DRY_FMT = flags.has("--format-dry");
const DRY_LNT = flags.has("--lint-dry");
const DTS     = flags.has("--dts");
const MAP_F   = flags.has("--map")  ? getArg("--map")  : null;
const PRUNE   = flags.has("--prune");
const DICT_F  = flags.has("--dict") ? getArg("--dict") : null;
const MIN_SCORE  = parseFloat(getArg("--min-score",  "0.5"));
const MIN_MARGIN = parseFloat(getArg("--min-margin", "0.2"));

////////////////////////////////////////////////////////////////////////////////
// Heuristic bank
////////////////////////////////////////////////////////////////////////////////
const H = o=>({patterns:[].concat(o.patterns),
  neg:[].concat(o.neg||[]),weight:o.weight??1,minScore:o.minScore,minMargin:o.minMargin});
const BANK = {
  getJson:        H({patterns:/fetch\s*\([^]*?\.json\s*\(/s,                 weight:1,minScore:.6}),
  postJson:       H({patterns:/method:\s*['"]?POST\b/i,                      weight:.9}),
  openWebSocket:  H({patterns:/new\s+WebSocket\s*\(/,                        weight:.8}),
  listenEvents:   H({patterns:/addEventListener\(\s*['"](open|message)/,     weight:.7}),
  getElement:     H({patterns:[/querySelector\s*\(/,/getElementBy/],         weight:.8}),
  onClick:        H({patterns:/addEventListener\(\s*['"]click/,              weight:.6}),
  getStorageItem: H({patterns:/localStorage\.getItem\(/,                     weight:.7}),
  setStorageItem: H({patterns:/localStorage\.setItem\(/,                     weight:.7}),
  computeHash:    H({patterns:/crypto\.subtle\.digest\(/,                    weight:.9}),
  filterItems:    H({patterns:/\.filter\s*\(/,                               weight:.4,minScore:.45}),
  mapItems:       H({patterns:/\.map\s*\(/,                                  weight:.4,minScore:.45}),
  reduceItems:    H({patterns:/\.reduce\s*\(/,                               weight:.4,minScore:.45}),
  handleError:    H({patterns:/\.catch\s*\(/,                                weight:.6}),
  processResponse:H({patterns:/\.then\s*\([^]*?\.then/s,                     weight:.5}),
  debounce:       H({patterns:/setTimeout/, neg:/setInterval/,               weight:.7,minMargin:.25}),
  parseDate:      H({patterns:/Date\.parse|new\s+Date\(/,                    weight:.5}),
  formatDate:     H({patterns:/toLocaleDateString|date-fns|moment/,          weight:.5}),
  lazyLoadModule: H({patterns:/import\(\s*[^)]+?\)/,                         weight:.6}),
  exportFunc:     H({patterns:/^exports\./,                                  weight:.8,minScore:.55})
};
if (DICT_F){
  const extra=JSON.parse(fs.readFileSync(DICT_F,"utf8"));
  for(const[k,v]of Object.entries(extra)) BANK[k]=H(v);
}
if (ftModel) { for(const k of Object.keys(BANK)) labelVecs[k]=ftModel.getSentenceVector(k); }
const embed = txt=>ftModel?ftModel.getSentenceVector(txt):null;

////////////////////////////////////////////////////////////////////////////////
// rename map (persist); track hits
////////////////////////////////////////////////////////////////////////////////
let renameMap = MAP_F && fs.existsSync(MAP_F)
  ? JSON.parse(fs.readFileSync(MAP_F,"utf8"))
  : {};
const mapHits = Object.fromEntries(Object.keys(renameMap).map(k=>[k,false]));

////////////////////////////////////////////////////////////////////////////////
// regex for minified
////////////////////////////////////////////////////////////////////////////////
const MINI = AGGR ? /^[a-z]$|^_[a-z]?$|^[a-z]\d$|^[a-z]{2}$/ : /^[a-z]$|^_[0-9]?$|^[a-z]\d$/;

////////////////////////////////////////////////////////////////////////////////
// plugin infrastructure
////////////////////////////////////////////////////////////////////////////////
const plugins=[];
if (fs.existsSync("./plugins")){
  for(const f of fs.readdirSync("./plugins").filter(x=>x.endsWith(".js"))){
    try{ plugins.push(await import(path.resolve("./plugins",f))); }
    catch(e){ console.warn(chalk.yellow(`plugin load ${f} failed: ${e}`)); }
  }
}
const safe=(fn,...args)=>{try{fn?.(...args);}catch(e){console.warn(chalk.yellow(`plugin err: ${e}`));}};

////////////////////////////////////////////////////////////////////////////////
// scoring helpers
////////////////////////////////////////////////////////////////////////////////
function score(snippet, old){
  const s={};
  for(const [label,h] of Object.entries(BANK)){
    const pos=h.patterns.some(re=>re.test(snippet));
    const neg=h.neg.some(re=>re.test(snippet));
    if(pos&&!neg) s[label]=(s[label]||0)+h.weight;
  }
  if (ftModel){
    const vec=embed(snippet.slice(0,600));
    if(vec){
      let best=null, bestDot=0;
      for(const [l,lv]of Object.entries(labelVecs)){
        const d=ftModel.cosine(vec,lv);
        if(d>bestDot){best=l;bestDot=d;}
      }
      if(best) s[best]=(s[best]||0)+bestDot*0.4;
    }
  }
  safe(plugins.forEach.bind(plugins),p=>safe(p.onCandidate,old,snippet,s));
  return s;
}
function choose(scores){
  const ranked=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  if(!ranked.length) return null;
  const [[label,score],[,second=0]=[]]=ranked;
  const h=BANK[label]||{};
  const minS=h.minScore??MIN_SCORE;
  const minM=h.minMargin??MIN_MARGIN;
  return score>=minS && score-second>=minM?label:null;
}

////////////////////////////////////////////////////////////////////////////////
// processing
////////////////////////////////////////////////////////////////////////////////
const progress = !REVIEW && new SingleBar({format:"{bar} {value}/{total} files"},Presets.shades_classic);
if(progress) progress.start(files.length,0);

let totalRen=0;
let linter = null;
if (LINT) {
  const ESLintClass = await getESLint();
  linter = new ESLintClass({ fix: true });
}


for(const file of files){
  const src=fs.readFileSync(file,"utf8");
  const ast=parser.parse(src,{sourceType:"unambiguous",
    plugins:["jsx","typescript","classProperties","dynamicImport","optionalChaining"]});
  const cands=new Map();

  // --- gather candidates (functions, vars, class/obj methods, CJS exports) ---
  traverse(ast,{
    FunctionDeclaration(p){ const n=p.node.id?.name; if(n&&MINI.test(n))cands.set(n,p); },
    VariableDeclarator(p){
      const id=p.get("id"); const init=p.get("init");
      if(id.isIdentifier()&&MINI.test(id.node.name)&&init.isFunction()) cands.set(id.node.name,init);
    },
    ClassMethod(p){ const n=p.node.key.name||p.node.key.value;
      if(typeof n==="string"&&MINI.test(n)) cands.set(n,p); },
    ObjectProperty(p){
      if(t.isIdentifier(p.node.key)){
        const n=p.node.key.name;
        if(MINI.test(n)&&p.get("value").isFunction()) cands.set(n,p.get("value"));
      }
    },
    AssignmentExpression(p){
      const {left,right}=p.node;
      if(!(t.isFunction(right)||t.isArrowFunctionExpression(right)))return;
      // exports.x
      if(t.isMemberExpression(left)&&t.isIdentifier(left.object,{name:"exports"})&&t.isIdentifier(left.property)){
        const n=left.property.name; if(MINI.test(n))cands.set(n,p.get("right"));
      }
      // module.exports.x
      if(t.isMemberExpression(left)&&t.isMemberExpression(left.object)&&
         t.isIdentifier(left.object.object,{name:"module"})&&t.isIdentifier(left.object.property,{name:"exports"})&&
         t.isIdentifier(left.property)){
        const n=left.property.name; if(MINI.test(n))cands.set(n,p.get("right"));
      }
      // module.exports = { a(){}, b:()=>{} }
      if(t.isMemberExpression(left)&&t.isIdentifier(left.object,{name:"module"})&&t.isIdentifier(left.property,{name:"exports"})
        && t.isObjectExpression(right)){
        for(const prop of right.properties){
          if(t.isIdentifier(prop.key)&& (t.isFunction(prop.value)||t.isArrowFunctionExpression(prop.value))){
            const n=prop.key.name; if(MINI.test(n)){
              const fakePath=p.get("right").get("properties").find(pr=>pr.node===prop).get("value");
              cands.set(n,fakePath);
            }
          }
        }
      }
    }
  });

  const localRen=[]; // per-file for .d.ts
  for(const [old,nodePath] of cands){
    const snippet=generate(nodePath.node).code;
    const s=score(snippet,old);
    if(renameMap[old]) s[renameMap[old]]=(s[renameMap[old]]||0)+2;
    const label=choose(s);
    if(label&&label!==old){
      nodePath.scope.rename(old,label);
      renameMap[old]=label; mapHits[old]=true; localRen.push({old,new:label});
      safe(plugins.forEach.bind(plugins),p=>safe(p.onRename,old,label,file));
      totalRen++;
    }
  }

  // propagate rename inside imports/exports (default + named)
  traverse(ast,{
    ImportSpecifier(p){ const imp=p.node.imported.name;
      if(renameMap[imp]){ p.node.imported.name=renameMap[imp]; p.node.local.name=renameMap[imp]; } },
    ImportDefaultSpecifier(p){
      const loc=p.node.local.name;
      if(renameMap[loc]) p.node.local.name=renameMap[loc];
    },
    ExportSpecifier(p){ const loc=p.node.local.name;
      if(renameMap[loc]){ p.node.local.name=renameMap[loc]; p.node.exported.name=renameMap[loc]; } },
    ExportDefaultDeclaration(p){
      if(t.isFunctionDeclaration(p.node.declaration)&&p.node.declaration.id){
        const n=p.node.declaration.id.name;
        if(renameMap[n]) p.node.declaration.id.name=renameMap[n];
      }
    }
  });

  let out=generate(ast,{retainLines:true,comments:true,compact:false}).code;
  if (FORMAT){ const pret=await getPrettier(); out=pret.format(out,{filepath:file}); }
  if (LINT){
    const [res] = await linter.lintText(out,{filePath:file});
    if(res.output&&!DRY_LNT) out=res.output;
  }

  const outPath = OUT_DIR ? path.join(OUT_DIR,path.basename(file)) : file;
  if (REVIEW){
    console.log(chalk.blue(`\n>> ${file}: ${localRen.length} rename(s)`));
    const patch=createPatch(file,src,out);
    console.log(patch);
  } else {
    fs.mkdirSync(path.dirname(outPath),{recursive:true});
    fs.writeFileSync(outPath,out);
    if (DTS && localRen.length){
      const sigs=localRen.map(({new:newN})=>`export function ${newN}(...args: any[]): any;`).join("\n");
      fs.writeFileSync(outPath.replace(/\.[jt]sx?$/,".d.ts"),sigs);
    }
    if(progress) progress.increment();
  }
}

/* prune unused map entries */
if(PRUNE){
  for(const k of Object.keys(renameMap)){ if(!mapHits[k]) delete renameMap[k]; }
}

/* persist map */
if(MAP_F) fs.writeFileSync(MAP_F,JSON.stringify(renameMap,null,2));

if(progress) progress.stop();
console.log(chalk.green(`\n✓  ${totalRen} identifiers renamed across ${files.length} file(s)`+
  (REVIEW?" (review mode, no files written)":"")));
