#!/usr/bin/env node
/**
 * runtime-trace.cjs
 * ------------------------------------------------------------
 * • Launches headless Chromium with Puppeteer
 * • Adds optional headers to every request  (-H|--header 'K: V')
 * • Hooks fetch, XMLHttpRequest, sendBeacon
 * • Logs  {url, method, stack}  as ND-JSON, one object per line
 *
 * USAGE
 *   node runtime-trace.cjs <url> <outFile.json> \
 *        [--header 'BugBounty-ID: YourHandle'] [...]
 *
 * EXAMPLE
 *   node runtime-trace.cjs https://target.tld trace.json \
 *        --header 'BugBounty-ID: MyHandle'
 * ------------------------------------------------------------
 */

const fs = require("fs");
const puppeteer = require("puppeteer");

/* ---------- CLI args ---------- */
const [,, target, outFileRaw = "endpoints_dyn.json", ...rest] = process.argv;
if (!target) {
  console.error("usage: node runtime-trace.cjs <url> <outFile> [--header 'K: V']");
  process.exit(1);
}

/* ---------- parse  --header flags ---------- */
const extraHeaders = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "-H" || rest[i] === "--header") {
    const hdr = rest[++i] || "";
    const idx = hdr.indexOf(":");
    if (idx > 0) {
      extraHeaders[hdr.slice(0, idx).trim()] = hdr.slice(idx + 1).trim();
    }
  }
}
const outFile = outFileRaw;

/* ---------- launch browser ---------- */
(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  if (Object.keys(extraHeaders).length) {
    await page.setExtraHTTPHeaders(extraHeaders);
  }

  /* ---------- collect console messages ---------- */
  const log = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.startsWith("[API]")) log.push(JSON.parse(t.slice(5)));
  });

  /* ---------- inject hook before any script runs ---------- */
  await page.evaluateOnNewDocument(() => {
    const push = (url, method) =>
      console.log(
        "[API]" +
          JSON.stringify({
            url,
            method,
            stack: new Error().stack.split("\n").slice(3, 10).join(" | "),
          }),
      );

    /* fetch */
    const _fetch = window.fetch;
    window.fetch = function (input, init = {}) {
      const url = input && input.url ? input.url : String(input);
      push(url, init.method || "GET");
      return _fetch.apply(this, arguments);
    };

    /* XMLHttpRequest */
    const _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__m = m; this.__u = u;
      return _open.apply(this, arguments);
    };
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      push(this.__u, this.__m);
      return _send.apply(this, arguments);
    };

    /* sendBeacon */
    const _beacon = navigator.sendBeacon;
    navigator.sendBeacon = function (u, d) {
      push(u, "BEACON");
      return _beacon.apply(this, arguments);
    };
  });

  /* ---------- drive page ---------- */
  await page.goto(target, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 30_000));   // idle window
  await browser.close();

  /* ---------- write ND-JSON ---------- */
  fs.writeFileSync(outFile, log.map((o) => JSON.stringify(o)).join("\n"), "utf8");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
