'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../ucb-core.js');
const source = fs.readFileSync(path.join(__dirname, '../src/sender.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 2)); };
function harness() {
  const calls = [], timers = new Map(); let nextTimer = 0, savedDoc = null, sourceFailure = false;
  const row = Object.fromEntries(core.KEYS.map(k => [k, ({ callId: '1001', aircraft: 'DEMO-01', workOrder: '00001001', status: 'Inwork', remarks: 'EXAMPLE ONLY.' })[k] || '']));
  const C = { ...core, reportContext: () => true, parseReport: () => ({ rows: [row], total: 1 }) };
  const win = { UcbEyesCore: C, isSecureContext: true, crypto: globalThis.crypto, URL, URLSearchParams, AbortController,
    TextEncoder, TextDecoder, btoa, atob, Set, Map, Date, Uint8Array, console: { info() {}, warn() {}, error() {} },
    document: { scripts: [{ src: 'https://ucb.example.test/Ucb/5F3D96C6EB4F757767F1A4D73FF240A0.cache.js' }] },
    location: { origin: 'https://ucb.example.test', protocol: 'https:' }, frames: [], closed: false,
    keycloak: { authenticated: true, token: 'LOCAL_UCB_TOKEN_ONLY' },
    confirm: () => true, prompt: () => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    sessionStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, removeEventListener() {},
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  win.top = win; win.window = win;
  win.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith(win.location.origin)) return new Response(sourceFailure ? '' : '//OK mock', { status: sourceFailure ? 503 : 200 });
    if (url.includes('accounts:signUp')) return Response.json({ idToken: 'FIREBASE_ONLY', refreshToken: 'REFRESH_ONLY', expiresIn: 3600 });
    if (url.endsWith(':commit')) {
      const payload = JSON.parse(options.body), last = payload.writes.at(-1);
      savedDoc = { fields: last.update.fields, updateTime: new Date().toISOString() };
      return Response.json({ writeResults: payload.writes.map(() => ({ updateTime: savedDoc.updateTime })) });
    }
    return savedDoc ? Response.json(savedDoc) : new Response('', { status: 404 });
  };
  vm.createContext(win);
  return { win, calls, timers, run: () => vm.runInContext(source, win), fail: () => { sourceFailure = true; } };
}
test('sender isolates credentials, encrypts first snapshot, sends quiet heartbeats and stops', async () => {
  const h = harness(); await h.run();
  assert.equal(h.win.__UCB_EYES__.running, true);
  const first = h.calls.find(c => c.url.endsWith(':commit'));
  const initial = JSON.parse(first.options.body);
  assert.equal(initial.writes.length, 2);
  const cloud = h.calls.filter(c => !c.url.startsWith(h.win.location.origin));
  assert.equal(JSON.stringify(cloud).includes('LOCAL_UCB_TOKEN_ONLY'), false);
  assert.equal(first.options.body.includes('EXAMPLE ONLY.'), false);
  const read = h.calls.find(c => c.url.startsWith(h.win.location.origin));
  assert.equal(read.options.headers.Authorization, 'Bearer LOCAL_UCB_TOKEN_ONLY');
  assert.equal(read.options.mode, 'same-origin'); assert.equal(first.options.credentials, 'omit');
  assert.ok([...h.timers.values()].some(t => t.delay <= 2000));
  h.win.__UCB_EYES__.sendNow(); await settle();
  const commits = h.calls.filter(c => c.url.endsWith(':commit'));
  assert.equal(commits.length, 2);
  assert.equal(JSON.parse(commits[1].options.body).writes.length, 1);
  assert.ok(JSON.parse(commits[1].options.body).writes[0].currentDocument.updateTime);
  h.win.__UCB_EYES__.stop(); const count = h.calls.length;
  h.win.__UCB_EYES__.sendNow(); await settle();
  assert.equal(h.calls.length, count); assert.equal(h.win.__UCB_EYES__.running, false);
});
test('a failed source read sends no fake fresh-data heartbeat', async () => {
  const h = harness(); await h.run(); const writes = h.calls.filter(c => c.url.endsWith(':commit')).length;
  h.fail(); h.win.__UCB_EYES__.sendNow(); await settle();
  assert.equal(h.calls.filter(c => c.url.endsWith(':commit')).length, writes);
  assert.match(h.win.__UCB_EYES__.status().error, /HTTP 503/); h.win.__UCB_EYES__.stop();
});
