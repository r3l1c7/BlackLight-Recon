<!-- =========================  BLACKLIGHT RECON  ========================= -->

<h1 align="center">
  <img src="https://raw.githubusercontent.com/yourhandle/blacklight-recon/main/.assets/logo.svg" width="120"/><br/>
  <strong>BlackLight Recon</strong>
</h1>
<p align="center">
  <em>“Shine the ultraviolet on every modern front-end &nbsp;—&nbsp; watch hidden APIs glow.”</em>
</p>

<p align="center">
  <img alt="CI badge" src="https://img.shields.io/github/actions/workflow/status/r3l1c7/blacklight-recon/ci.yml?style=for-the-badge">
  <img alt="License" src="https://img.shields.io/github/license/r3l1c7/blacklight-recon?style=for-the-badge">
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
git clone https://github.com/r3l1c7/blacklight-recon.git
cd blacklight-recon
npm i puppeteer --save-dev        # once: pulls headless Chrome
go install github.com/BishopFox/jsluice/cmd/jsluice@latest
sudo apt install jq wget          # Debian / Kali
npm i -g prettier chalk diff cli-progress
npm install --save-dev eslint
npm i -g @babel/cli @babel/core @babel/types @babel/parser @babel/generator @babel/traverse babel-plugin-transform-react-createelement-to-jsx
./scan.sh --url https://target.app \
          --header 'BugBounty-ID: hacker123'  # repeat -H for multiple headers
```
---

## 💡  What BlackLight does

1. **Mirror** JavaScript only — honours any header you pass.  
2. **Split** bundles:  
   * Webpack 4/5 splitter → `modules-wp5/`  
   * Rollup / Vite splitter → `modules-roll/`  
3. **Prettify** for human diff (optional).  
4. **AST scrape** → URLs + secrets.  
5. **Headless trace** → grabs every runtime API with call-site stacks.  
6. **Filter & merge** — drops `png|jpg|svg|woff|css`, de-dupes on `url + method`.  

End result:  

blacklight-scan-YYYYMMDD_HHMM/ ├─ endpoints_full.json ← de-duplicated STATIC + RUNTIME APIs └─ secrets_static.json ← hard-coded keys / tokens

yaml
Copy
Edit

---

## 🛠️  Installation matrix

| Component | Min. version | Notes |
|-----------|--------------|-------|
| **Node.js** | 18.x | Built-in `fetch`, ES 2022 |
| **Puppeteer** | 19+ | Auto-downloads Chromium |
| **jsluice** | latest | `go install …` |
| **jq** | ≥ 1.6 | apt / brew / choco |
| **Prettier** | any | optional but nice |

---

## 👾  Feature grid vs. the usual suspects

| Capability | LinkFinder | JS Miner (Burp) | jsluice-raw | **BlackLight** |
|------------|------------|-----------------|-------------|----------------|
| Auto-split WP 5 numeric bundles | ✗ | ✗ | ✗ | **✓** |
| Rollup / Vite splitter | ✗ | ✗ | ✗ | **✓** |
| AST URL + secret scrape | △ regex | △ | **✓** | **✓** |
| Runtime trace with stack lines | ✗ | ✗ | ✗ | **✓** |
| Single header flag (`-H`) | ✗ | ✗ | ✗ | **✓** |
| Built-in asset filter | ✗ | ✗ | ✗ | **✓** |
| Ready for Burp import | ✗ | **✓** | ✗ | **✓** |

*(△ = basic regex only)*

---

## 🛰️  Roadmap

* WebSocket & EventSource capture  
* Session-cookie replay for auth’d scans  
* GitHub Action to diff deploy-to-deploy and ping Slack  
* Burp Suite plug-in (JSON import → Sitemap)

---

### 🤝  Contributing

Bug reports, PRs, and crazy feature ideas welcome!  
Run `./dev/run-tests.sh` before pushing; CI enforces shell & Node lint.

---

## ⚖️  License

MIT — burn bandwidth, **not** production creds ☠️  
Big props to the **jsluice**, **Puppeteer**, and **Prettier** teams for the heavy lifting.

> **BlackLight Recon** — because every SPA has stains you can only see under UV.
