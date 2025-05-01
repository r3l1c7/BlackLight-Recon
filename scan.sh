#!/usr/bin/env bash
# scan.sh – one-shot JS bundle scanner (Webpack + Rollup/Vite)
# usage: ./scan.sh --url https://target.tld [--out outDir]

set -euo pipefail

################ CLI ################
URL=""; OUT="scan-$(date +%Y%m%d_%H%M%S)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--url) URL="$2"; shift 2 ;;
    -o|--out) OUT="$2"; shift 2 ;;
    *) echo "unknown flag $1"; exit 1 ;;
  esac
done
[[ -z "$URL" ]] && { echo "usage: scan.sh --url <target> [--out dir]"; exit 1; }

################ paths ##############
mkdir -p "$OUT"/{dump,tmp}
ROOT="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &>/dev/null && pwd )"

UNIVERSAL="$ROOT/unbundle-universal.mjs"
ROLLUP="$ROOT/unbundle-roll.mjs"
TRACER="$ROOT/runtime-trace.cjs"
SMART="$ROOT/smart-rename.mjs"
################ 1. mirror ###########
echo "[+] Mirroring JS assets"
wget -q -E -H -k -p -r -l1 -nd -A '*.js,*.mjs' -P "$OUT/dump" "$URL"

################ 2. de-bundle ########
echo "[+] De-bundling Webpack, Rollup, esbuild"
find "$OUT/dump" -type f -name '*.js' -print0 | xargs -0 -P4 node "$UNIVERSAL"
find "$OUT/dump" -type f -name '*.js' -print0 | xargs -0 -P4 node "$ROLLUP"

################ 3. prettify #########
echo "[+] Prettifying modules"
# only prettify if there are modules
if find "$OUT/dump" -type f \( -path '*/modules-wp5/*.js' -o -path '*/modules-roll/*.js' \) | grep -q .; then
  find "$OUT/dump" -type f \( -path '*/modules-wp5/*.js' -o -path '*/modules-roll/*.js' \) -print0 \
    | xargs -0 -P4 prettier --write
else
  echo "    (!) No extracted modules found"
fi


################ 3.5 semantic rename #########
echo "[+] Semantic de-minification"
if find "$OUT/dump" -type f \( \
      -path '*/modules-wp5/*.js' -o \
      -path '*/modules-roll/*.js' \
   \) | grep -q .; then

  find "$OUT/dump" -type f \( \
      -path '*/modules-wp5/*.js' -o \
      -path '*/modules-roll/*.js' \
   \) -print0 \
    | xargs -0 -P4 node "$SMART" \
        --out-dir "$OUT/dump" \
        --map "$OUT/rename-map.json" \
        --format --lint \
    || echo "    (!) smart-rename failed"

else
  echo "    (!) No extracted modules found for semantic de-minification"
fi

################ 4. static scrape ####
echo "[+] Static URL & secret scrape"
find "$OUT/dump" -type f \( -path '*/modules-wp5/*.js' -o -path '*/modules-roll/*.js' \) -print0 \
  | xargs -0 -P4 jsluice urls    > "$OUT/endpoints_static.json"

find "$OUT/dump" -type f \( -path '*/modules-wp5/*.js' -o -path '*/modules-roll/*.js' \) -print0 \
  | xargs -0 -P4 jsluice secrets > "$OUT/secrets_static.json"
################ 5. runtime trace ####
echo "[+] Headless run for dynamic endpoints"
if node "$TRACER" "$URL" "$OUT/endpoints_dyn.json"; then
  echo "( tracer OK )"
else
  echo "    (!) Runtime trace failed – continuing with static only"
  printf '[]\n' > "$OUT/endpoints_dyn.json"
fi

################ 5½  filter runtime #######################
echo "[+] Pre-filtering runtime noise"

# ONE backslash for jq, nothing more
FILTER_RE='\\.(png|jpe?g|gif|svg|webp|ico|bmp|tiff?|woff2?|woff|ttf|otf|eot|css|mp3|mp4|scss)(\\?|$)'

dynClean="$OUT/endpoints_dyn_clean.json"

jq -R -c --arg re "$FILTER_RE" '
  select(length>0)
  | fromjson
  | (if type=="array" then .[] else . end)
  | select(.url | test($re;"i") | not)      # drop images / fonts / styles
'  "$OUT/endpoints_dyn.json" > "$dynClean"

################ 6  merge static + dyn ####################
echo "[+] Merging static + dynamic"

[ -s "$OUT/endpoints_static.json" ] || : > "$OUT/endpoints_static.json"

cat  "$OUT/endpoints_static.json" "$dynClean" |
jq  -R -c '
  select(length>0)
  | fromjson
  | (if type=="array" then .[] else . end)
' |
jq  -s -c 'unique_by(.url,.method)' \
    > "$OUT/endpoints_full.json"


################ done ###############
echo -e "\n🎉  Scan complete → $OUT/"
echo "   • endpoints_full.json   (static+dyn, de-duplicated)"
echo "   • secrets_static.json   (hard-coded keys/tokens)"
