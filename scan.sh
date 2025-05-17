#!/usr/bin/env bash
# scan.sh – one-shot JS bundle scanner (Webpack + Rollup/Vite)
# usage: ./scan.sh --url https://target.tld [--out outDir] [-H 'K: V']...
#         (-H/--header can be repeated)

set -euo pipefail

################ CLI ################
URL=""; OUT="scan-$(date +%Y%m%d_%H%M%S)"; HEADERS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--url) URL="$2"; shift 2 ;;
    -o|--out) OUT="$2"; shift 2 ;;
    -H|--header) HEADERS+=("$2"); shift 2 ;;
    *) echo "unknown flag $1"; exit 1 ;;
  esac
done
[[ -z "$URL" ]] && {
  echo "usage: scan.sh --url <target> [--out dir] [-H 'K: V']...";
  exit 1;
}

################ paths ##############
mkdir -p "$OUT"/{dump,tmp}
ROOT="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &>/dev/null && pwd )"

UNIVERSAL="$ROOT/unbundle-universal.mjs"
ROLLUP="$ROOT/unbundle-roll.mjs"
TRACER="$ROOT/runtime-trace.cjs"
SMART="$ROOT/smart-rename.mjs"

################ 1. mirror ###########
echo "[+] Mirroring JS assets"
WGET_OPTS=()
for h in "${HEADERS[@]}"; do
  WGET_OPTS+=(--header="$h")
done
wget -q -E -H -k -p -r -l1 -nd -A '*.js,*.mjs' "${WGET_OPTS[@]}" -P "$OUT/dump" "$URL"

################ 2. de-bundle ########
echo "[+] De-bundling Webpack, Rollup, esbuild"
find "$OUT/dump" -type f \( -name '*.js' -o -name '*.mjs' \) -print0 \
  | xargs -0 -P4 node "$UNIVERSAL"
find "$OUT/dump" -type f \( -name '*.js' -o -name '*.mjs' \) -print0 \
  | xargs -0 -P4 node "$ROLLUP"

################ 3. prettify #########
echo "[+] Prettifying modules"
if find "$OUT/dump" -type f \( -path '*/modules-wp5/*.js' -o -path '*/modules-roll/*.js' \) | grep -q .; then
  find "$OUT/dump" -type f \( -path '*/modules-wp5/*.js' -o -path '*/modules-roll/*.js' \) -print0 \
    | xargs -0 -P4 prettier --write
else
  echo "    (!) No extracted modules found"
fi

################ 3.5 semantic rename #########
echo "[+] Semantic de-minification"
if find "$OUT/dump" -type f \( -path '*/modules-wp5/*.js' -o -path '*/modules-roll/*.js' \) | grep -q .; then
  find "$OUT/dump" -type f \( -path '*/modules-wp5/*.js' -o -path '*/modules-roll/*.js' \) -print0 \
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
# first try split modules
mods=$(find "$OUT/dump" -type f \( -path '*/modules-wp5/*.js' -o -path '*/modules-roll/*.js' \))
if [[ -n "$mods" ]]; then
  printf '%s\0' $mods | xargs -0 -P4 jsluice urls    > "$OUT/endpoints_static.json"
  printf '%s\0' $mods | xargs -0 -P4 jsluice secrets > "$OUT/secrets_static.json"
else
  echo "    (!) No split modules—falling back to raw JS assets"
  raw=$(find "$OUT/dump" -type f -name '*.js')
  printf '%s\0' $raw | xargs -0 -P4 jsluice urls    > "$OUT/endpoints_static.json"
  printf '%s\0' $raw | xargs -0 -P4 jsluice secrets > "$OUT/secrets_static.json"
fi

################ 5. runtime trace ####
echo "[+] Headless run for dynamic endpoints"
TRACER_OPTS=()
for h in "${HEADERS[@]}"; do
  TRACER_OPTS+=(--header "$h")
done
if node "$TRACER" "$URL" "$OUT/endpoints_dyn.json" "${TRACER_OPTS[@]}"; then
  echo "( tracer OK )"
else
  echo "    (!) Runtime trace failed – continuing with static only"
  printf '[]\n' > "$OUT/endpoints_dyn.json"
fi

################ 5½  filter runtime #######################
echo "[+] Pre-filtering runtime noise"

FILTER_RE='\\.(png|jpe?g|gif|svg|webp|ico|bmp|tiff?|woff2?|woff|ttf|otf|eot|css|mp3|mp4|scss)(\\?|$)'

dynClean="$OUT/endpoints_dyn_clean.json"

jq -R -c --arg re "$FILTER_RE" '
  select(length>0)
  | fromjson
  | (if type=="array" then .[] else . end)
  | select(.url | test($re;"i") | not)
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
