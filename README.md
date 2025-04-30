<!-- =========================  BLACKLIGHT RECON  ========================= -->

<h1 align="center">
  <img src="https://raw.githubusercontent.com/yourhandle/blacklight-recon/main/.assets/logo.svg" width="120"/><br/>
  <strong>BlackLight Recon</strong>
</h1>
<p align="center">
  <em>“Shine the ultraviolet on every modern front-end &nbsp;—&nbsp; watch hidden APIs glow.”</em>
</p>

<p align="center">
  <img alt="CI badge" src="https://img.shields.io/github/actions/workflow/status/yourhandle/blacklight-recon/ci.yml?style=for-the-badge">
  <img alt="License" src="https://img.shields.io/github/license/yourhandle/blacklight-recon?style=for-the-badge">
  <img alt="Lines of Bash" src="https://img.shields.io/badge/bash-~250 loc-4EAA25?style=for-the-badge">
</p>

---

### ⚡  Why BlackLight Recon?

| Problem | Old-school fix | **BlackLight** way |
|---------|----------------|--------------------|
| Webpack 5/Vite bundles hide strings without source-maps | `linkfinder.py` → shows nothing | *Universal splitter* cracks WP 4/5, Rollup, Vite, esbuild **without maps** |
| APIs lazy-load after a click | Manual DevTools clicking | *Headless tracer* hooks `fetch/XHR/Beacon`, waits 30 s idle, logs every call with JS stack |
| Bug-bounty programs require an ID header | Re-compile scanner, hope you remembered everywhere | `--header 'BugBounty-ID: hacker123'` injects into **wget + headless Chrome** automatically |
| Output full of images/woff/css noise | Grep & pray | Built-in regex filter nukes static assets, keeps pure endpoints |

---

## 🚀  TL;DR — one-liner

```bash
git clone https://github.com/yourhandle/blacklight-recon.git
cd blacklight-recon
npm i puppeteer --save-dev        # once: pulls headless Chrome
go install github.com/BishopFox/jsluice/cmd/jsluice@latest
sudo apt install jq wget          # Debian / Kali
npm i -g prettier

./scan.sh --url https://target.app \
          --header 'BugBounty-ID: hacker123'
