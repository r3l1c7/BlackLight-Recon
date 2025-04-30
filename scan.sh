#!/usr/bin/env bash
# scan.sh – one-shot JS bundle scanner (Webpack + Rollup/Vite)
# usage: ./scan.sh --url https://target.tld [--out outDir]

set -euo pipefail

############ CLI ############
URL=""; OUT="scan-$(date +%Y%m%d_%H%M%S)"; HDRS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--url)    URL="$2"; shift 2 ;;
    -o|--out)    OUT="$2"; shift 2 ;;
    -H|--header) HDRS+=("$2"); shift 2 ;;          # <── NEW
    *) echo "unknown flag $1"; exit 1 ;;
  esac
done
[[ -z "$URL" ]] && { echo "usage: scan.sh --url <target> [--header 'K: V']"; exit 1; }

############ paths ##########
mkdir -p "$OUT"/{dump,tmp}
ROOT="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &>/dev/null && pwd )"
UNIVERSAL="$ROOT/unbundle-universal.mjs"
ROLLUP="$ROOT/unbundle-roll.mjs"
TRACER="$ROOT/runtime-trace.cjs"

############ 1. mirror JS ###
echo "[+] Mirroring JS assets"
WGET_H=()
for h in "${HDRS[@]}"; do WGET_H+=(--header "$h"); done
wget -q -E -H -k -p -r -l1 -nd -A '*.js,*.mjs' "${WGET_H[@]}" -P "$OUT/dump" "$URL"

############ 2 – 5 unchanged (de-bundle, prettify, static scrape) ############
# … (keep exactly what you already have) …

############ 5. runtime trace ############
echo "[+] Headless run for dynamic endpoints"
node "$TRACER" "$URL" "$OUT/endpoints_dyn.json" "${HDRS[@]}" || {
  echo "    (!) Runtime trace failed – continuing with static only"
  printf '[]\n' > "$OUT/endpoints_dyn.json"
}

################ 5½. pre-filter dyn ############
echo "[+] Pre-filtering runtime noise"

FILTER_RE='\\.(png|jpe?g|gif|svg|webp|ico|bmp|tiff?|woff2?|woff|ttf|otf|eot|css)(\\?|$)'

tmpDyn="$OUT/endpoints_dyn_clean.json"
jq -R --arg re "$FILTER_RE" '
  select(length>0)
  | fromjson
  | (if type=="array" then .[] else . end)
  | select(.url | test($re;"i") | not)
' "$OUT/endpoints_dyn.json" > "$tmpDyn"

################ 6. merge  ######################
echo "[+] Merging static + dynamic"

cat   "$OUT/endpoints_static.json" "$tmpDyn" |
jq -R '
    select(length>0) | fromjson
    | (if type=="array" then .[] else . end)
' |
jq -s 'unique_by(.url,.method)' \
  > "$OUT/endpoints_full.json"


################ done ###############
echo -e "\n🎉  Scan complete → $OUT/"
echo "   • endpoints_full.json   (static+dyn, de-duplicated)"
echo "   • secrets_static.json   (hard-coded keys/tokens)"
