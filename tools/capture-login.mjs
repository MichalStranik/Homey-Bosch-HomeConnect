// One-shot helper: opens a clean Chrome window, lets the user sign in to
// SingleKey ID, captures the hcauth:// redirect via the DevTools Protocol
// (a normal browser silently drops it), exchanges the code and writes devices.json.
//
//   node tools/capture-login.mjs [out.json]
//
// Requires `npm run build` first (uses .homeybuild/lib) and env.json.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const oauth = require("../.homeybuild/lib/home-connect-oauth.js");
const { discoverAppliances } = require("../.homeybuild/lib/home-connect-discovery.js");

const out = process.argv[2] ?? "devices.json";
const clientId = JSON.parse(readFileSync("env.json", "utf8")).HOMECONNECT_CLIENT_ID;
const chrome =
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((p) => { try { readFileSync(p); return true; } catch { return false; } }) ;
const PORT = 9333;

const pkce = oauth.createPkce();
const url = oauth.buildAuthorizeUrl(pkce, clientId);
const profile = mkdtempSync(join(tmpdir(), "hc-login-"));

const proc = spawn(chrome ?? "chrome", [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore", detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(500); }
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));

const found = new Promise((resolve) => {
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    const hit = (s) => typeof s === "string" && s.startsWith("hcauth://") ? s : null;
    const loc = hit(m.params?.request?.url) ||
      hit(m.params?.redirectResponse?.headers?.location) ||
      hit(m.params?.redirectResponse?.headers?.Location) ||
      hit(m.params?.response?.headers?.location) ||
      hit(m.params?.response?.headers?.Location) ||
      hit(m.params?.url);
    if (loc) resolve(loc);
  };
});
send("Network.enable");
send("Page.enable");
send("Page.navigate", { url });
console.log("Chrome window opened - sign in with SingleKey ID there. Waiting for the redirect...");

const redirect = await Promise.race([found, sleep(10 * 60 * 1000).then(() => null)]);
if (!redirect) { console.error("Timed out"); proc.kill(); process.exit(1); }
const { code, state } = oauth.parseRedirectUrl(redirect);
if (state !== pkce.state) throw new Error("state mismatch");
console.log("Captured authorization code; exchanging...");
const token = await oauth.exchangeCode(code, pkce.verifier, clientId);
const devices = await discoverAppliances(token, (m) => console.log(" ", m));
writeFileSync(out, JSON.stringify(devices, null, 2));
console.log(`Wrote ${devices.length} appliance(s) to ${out} - import it in the app settings (Import devices.json).`);
if (token.refreshToken) console.log("(refresh token received; not saved)");
try { ws.close(); proc.kill(); } catch {}
