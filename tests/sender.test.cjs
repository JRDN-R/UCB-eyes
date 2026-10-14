'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../ucb-core.js');
const source = fs.readFileSync(path.join(__dirname, '../src/sender.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 2)); };
function harness(previousKey = null) {
  const calls = [], timers = new Map(), logs = [], stored = new Map();
  if (previousKey !== null) stored.set('ucb-eyes-sender-key-v1', previousKey);
  let nextTimer = 0, savedDoc = null, sourceFailure = false;
  const row = Object.fromEntries(core.KEYS.map(k => [k, ({ callId: '1001', aircraft: 'DEMO-01', workOrder: '00001001', status: 'Inwork', remarks: 'EXAMPLE ONLY.' })[k] || '']));
  const C = { ...core, reportContext: () => true, parseReport: () => ({ rows: [row], total: 1 }) };
  const win = { UcbEyesCore: C, isSecureContext: true, crypto: globalThis.crypto, URL, URLSearchParams, AbortController,
    TextEncoder, TextDecoder, btoa, atob, Set, Map, Date, Uint8Array,
    console: { info: message => logs.push(String(message)), warn() {}, error() {} },
    document: { scripts: [{ src: 'https://ucb.example.test/Ucb/5F3D96C6EB4F757767F1A4D73FF240A0.cache.js' }] },
    location: { origin: 'https://ucb.example.test', protocol: 'https:' }, frames: [], closed: false,
    keycloak: { authenticated: true, token: 'LOCAL_UCB_TOKEN_ONLY' },
    confirm: () => true, prompt: () => { throw new Error('Sender must not request a pairing code.'); },
    sessionStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
    addEventListener() {}, removeEventListener() {},
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
  return { win, calls, timers, logs, stored, run: () => vm.runInContext(source, win), fail: () => { sourceFailure = true; } };
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

test('sender automatically creates a private link without any pairing prompt', async () => {
  const h = harness(); await h.run();
  const url = new URL(h.win.__UCB_EYES__.viewerUrl);
  const secret = new URLSearchParams(url.hash.slice(1)).get('key');
  assert.equal(url.origin, 'https://jrdn-r.github.io');
  assert.equal(url.pathname, '/UCB-eyes/');
  assert.equal(url.search, '');
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(secret, h.stored.get('ucb-eyes-sender-key-v1'));
  assert.equal(Object.hasOwn(h.win.__UCB_EYES__, 'pairingCode'), false);
  assert.equal(h.logs.filter(v => v.includes('Private iPhone viewer link')).length, 1);
  assert.equal(h.logs.some(v => v.startsWith('Pairing code:')), false);
  h.win.__UCB_EYES__.stop();
});
test('sender silently reuses prior session key, regenerates damaged keys', async () => {
  const old = core.makeCode();
  const reused = harness(old); await reused.run();
  assert.equal(new URLSearchParams(new URL(reused.win.__UCB_EYES__.viewerUrl).hash.slice(1)).get('key'), old);
  reused.win.__UCB_EYES__.stop();
  const damaged = harness('NOT_A_VALID_KEY'); await damaged.run();
  const next = damaged.stored.get('ucb-eyes-sender-key-v1');
  assert.notEqual(next, 'NOT_A_VALID_KEY');
  assert.match(next, /^[A-Za-z0-9_-]{43}$/);
  damaged.win.__UCB_EYES__.stop();
});
