/* UCB Eyes console sender. Paste this ENTIRE file in DevTools Console > top. */
/* No HAR, cookies, UCB credentials, source HTML or screenshots are uploaded. */
(function () {
/* UCB Eyes: pure parsing, validation and encrypted transport. No network calls. */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.UcbEyesCore = core;
})(globalThis, function () {
  'use strict';
  const VERSION = 'ucb-text-v1';
  const TITLE = 'E&E Outstanding Report';
  const KEYS = ['status', 'callId', 'certifier', 'aircraft', 'workOrder', 'trade',
    'requestDate', 'planner', 'examiner', 'inWorkDate', 'responses', 'remarks'];
  const MAX_ROWS = 1000;
  const text = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  const flat = value => text(value).replace(/\s+/g, ' ');
  function validateSnapshot(value) {
    if (!value || value.schema !== VERSION || value.title !== TITLE ||
        value.facility !== 'JAX' || value.program !== 'TRAINERS' ||
        !['rpc', 'dom'].includes(value.mode) || !Array.isArray(value.rows) || value.rows.length > MAX_ROWS)
      throw new Error('Not a supported JAX / TRAINERS E&E report.');
    const ids = new Set();
    const rows = value.rows.map(row => {
      if (!row || typeof row !== 'object') throw new Error('Invalid report row.');
      const result = {};
      for (const k of KEYS) {
        if (typeof row[k] !== 'string' || row[k].length > (k === 'remarks' ? 20000 : 500))
          throw new Error('Invalid report field: ' + k);
        result[k] = row[k];
      }
      if (!/^\d{1,12}$/.test(result.callId) || ids.has(result.callId))
        throw new Error('Missing or duplicate Call ID.');
      ids.add(result.callId);
      return result;
    });
    return { schema: VERSION, title: TITLE, facility: 'JAX', program: 'TRAINERS',
      mode: value.mode, scope: value.mode === 'rpc' ? 'all-pages' : 'visible-page',
      pagination: flat(value.pagination || '').slice(0, 100), rows };
  }
  function snapshot(rows, mode, pagination = '') {
    return validateSnapshot({ schema: VERSION, title: TITLE, facility: 'JAX', program: 'TRAINERS', mode, pagination, rows });
  }
  function reportContext(doc) {
    const title = [...doc.querySelectorAll('.ucb-report-table thead th')]
      .some(el => flat(el.textContent) === TITLE);
    return title && flat(doc.getElementById('call-request-display-facility')?.textContent) === 'JAX' &&
      flat(doc.getElementById('call-request-display-program')?.textContent) === 'TRAINERS';
  }
  function parseDOM(doc) {
    if (!reportContext(doc)) throw new Error('Open JAX / TRAINERS / E&E / Outstanding in UCB first.');
    const container = doc.getElementById('responseTableContainer') || doc;
    const rows = [];
    for (const tbody of container.querySelectorAll('.ucb-report-table > tbody')) {
      const groups = new Map();
      for (const tr of tbody.querySelectorAll(':scope > tr[cst_row_index]')) {
        const index = tr.getAttribute('cst_row_index');
        if (!groups.has(index)) groups.set(index, new Map());
        for (const td of tr.querySelectorAll(':scope > td[customindex]')) {
          const col = Number(td.getAttribute('customindex'));
          // Preserve line breaks and spelling in remarks; remove layout whitespace elsewhere.
          const raw = td.textContent || '';
          groups.get(index).set(col, col === 11 ? text(raw) : flat(raw));
        }
      }
      for (const cells of groups.values()) {
        if (![...Array(12).keys()].every(i => cells.has(i)))
          throw new Error('The report is being redrawn; an incomplete row was ignored.');
        rows.push(Object.fromEntries(KEYS.map((key, i) => [key, cells.get(i)])));
      }
    }
    const pagination = [...container.querySelectorAll('.gwt-HTML')].map(e => flat(e.textContent))
      .find(s => /^\d+\s*[-–]\s*\d+\s+of\s+\d+$/i.test(s)) || '';
    if (!rows.length && !/^0\s*[-–]\s*0\s+of\s+0$/i.test(pagination) &&
        ![...container.querySelectorAll('.ndms-NoDataPanel')].some(e => /no (data|records|requests)/i.test(e.textContent)))
      throw new Error('No complete rows or explicit empty-report marker yet.');
    return snapshot(rows, 'dom', pagination);
  }

  // Wire schemas verified against the supplied GWT 2.8 report response and serializers.
  // Exact type signatures fail closed after incompatible UCB releases. These aliases
  // are internal wire fields, NOT the object sent to Firebase.
  const schemas = {
    "mil.navy.ndms.ucb.gwt.common.shared.dto.support.GenericUcbDto/1398413682": "a:o b:o c:o d:o e:o f:o g:s i:o j:o k:o",
    "mil.navy.ndms.ucb.gwt.common.shared.report.ReportData/35051220": "a:o b:o c:o d:i e:i f:s g:i i:i j:o k:o n:o",
    "mil.navy.ndms.ucb.gwt.common.shared.report.ReportHistoryDataRow/3774991779": "a:b b:o c:o d:b e:o f:b g:o i:s j:s k:s n:o o:s",
    "mil.navy.ndms.ucb.gwt.common.shared.domain.CallSourceWithResponse/2218945681": "a:o b:o __hash:s c:s d:s e:o f:o g:s i:s j:s k:s n:o o:o p:s q:o r:s s:s",
    "mil.navy.ndms.ucb.gwt.common.shared.domain.CallRequest/2964178198": "__hash:s a:s b:s c:s d:s e:o f:o g:o i:o j:s k:s n:o o:s p:o q:s r:o s:o t:s u:o v:s w:s A:s B:s C:o D:s F:s G:o H:s I:o J:s K:s L:s M:s N:s O:s P:s Q:s R:s",
    "mil.navy.ndms.ucb.gwt.common.shared.domain.CallResponse/198420672": "__hash:s a:o b:o c:o d:s e:s f:s g:s i:s j:s k:s n:o o:o p:s q:s",
    "mil.navy.ndms.ucb.gwt.common.shared.report.ReportExecutionContext/1449797842": "a:i b:s c:s d:s e:o f:i g:o i:o j:i k:o",
    "mil.navy.ndms.ucb.gwt.common.shared.report.ReportSortElement/3491951016": "a:i b:o c:o",
    "mil.navy.ndms.ucb.gwt.common.shared.report.ReportParameter/3872375245": "a:s b:o c:s d:b e:b f:b g:b i:s j:b k:o n:b",
  };
  const scalars = new Set(['java.lang.Integer/3438268394', 'java.lang.Boolean/476441737',
    'java.lang.Double/858496421', 'java.lang.Float/1718559123',
    'mil.navy.ndms.ucb.gwt.common.shared.report.DatabaseObjectName/2235062944',
    'mil.navy.ndms.ucb.gwt.common.shared.report.SqlParameterTypes/343522771',
    'mil.navy.ndms.gwt.integri.common.shared.constants.SortConstants/1229288516']);
  const lists = new Set(['java.util.ArrayList/4159755760', 'java.util.LinkedList/3953877921',
    'java.util.Arrays$ArrayList/2507071751']);
  function decodeGwt(response) {
    if (typeof response !== 'string' || response.length > 3000000 || !response.startsWith('//OK'))
      throw new Error('UCB did not return a successful report. Reopen the report and check your session.');
    let wire;
    try { wire = JSON.parse(response.slice(4)); } catch {
      throw new Error('Unsupported UCB response format. No response code was executed.');
    }
    if (!Array.isArray(wire) || wire.pop() !== 7 || wire.pop() !== 0)
      throw new Error('Unsupported GWT protocol.');
    const strings = wire.pop();
    if (!Array.isArray(strings) || !strings.every(s => typeof s === 'string') || wire.length > 200000)
      throw new Error('Invalid GWT string table.');
    const refs = [];
    function take() { if (!wire.length) throw new Error('Incomplete GWT response.'); return wire.pop(); }
    function integer() { const v = take(); if (!Number.isSafeInteger(v)) throw new Error('Invalid GWT integer.'); return v; }
    function string(index = integer()) {
      if (index === 0) return '';
      if (index < 1 || index > strings.length) throw new Error('Invalid GWT string reference.');
      return strings[index - 1];
    }
    function long() {
      const v = take();
      if (typeof v !== 'string' || !/^[A-Za-z0-9$_]{1,11}$/.test(v)) throw new Error('Invalid GWT date.');
      let n = 0n;
      for (const c of v) n = (n << 6n) | BigInt('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_'.indexOf(c));
      const result = Number(BigInt.asIntN(64, n));
      if (!Number.isSafeInteger(result)) throw new Error('GWT date exceeds safe precision.');
      return result;
    }
    function object(depth = 0) {
      if (depth > 100 || refs.length > 30000) throw new Error('GWT object limit exceeded.');
      const id = integer();
      if (id === 0) return null;
      if (id < 0) {
        if (-id > refs.length) throw new Error('Invalid GWT object reference.');
        return refs[-id - 1];
      }
      const type = string(id), slot = refs.length;
      let result = { _type: type };
      refs.push(result);
      if (Object.prototype.hasOwnProperty.call(schemas, type)) {
        for (const field of schemas[type].split(' ')) {
          const [key, kind] = field.split(':');
          result[key] = kind === 'o' ? object(depth + 1) : kind === 's' ? string() : integer();
        }
      } else if (lists.has(type) || type === 'java.util.Collections$EmptyList/4157118744' ||
                 type === 'java.util.Collections$SingletonList/1586180994') {
        const length = lists.has(type) ? integer() : type.includes('EmptyList') ? 0 : 1;
        if (length < 0 || length > 5000) throw new Error('Invalid GWT list length.');
        result = []; refs[slot] = result;
        for (let i = 0; i < length; i++) result.push(object(depth + 1));
      } else if (scalars.has(type)) result = integer();
      else if (type === 'java.lang.String/2004016611') result = string();
      else if (['java.sql.Timestamp/3040052672', 'java.util.Date/3385151746', 'java.sql.Date/730999118'].includes(type)) {
        result = { ms: long() };
        if (type.startsWith('java.sql.Timestamp/')) result.nanos = integer();
      } else throw new Error('UCB wire schema changed: ' + type.split('/')[0].split('.').pop());
      refs[slot] = result;
      return result;
    }
    const result = object();
    if (wire.length) throw new Error('Unconsumed GWT data; refusing an incomplete interpretation.');
    return result;
  }
  const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
  function formatDate(date) {
    if (date == null) return '';
    if (!Number.isSafeInteger(date.ms)) throw new Error('Invalid report timestamp.');
    const p = Object.fromEntries(dateFormat.formatToParts(date.ms).map(v => [v.type, v.value]));
    return `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute} ${p.dayPeriod}`;
  }
  function parseReport(response) {
    const dto = decodeGwt(response), report = dto?.a;
    if (!report?._type?.endsWith('ReportData/35051220') ||
        report.j?.a !== 1 || report.j?.b !== 'JAX' || report.j?.d !== 'TRAINERS' || report.j?.f !== 1)
      throw new Error('UCB returned a different report context.');
    const records = report.c ?? [];
    if (!Array.isArray(records) || !Number.isSafeInteger(report.i) || report.i < 0 || report.i > MAX_ROWS)
      throw new Error('Invalid report row count.');
    const rows = records.map(row => {
      const source = row.c, request = source?.f;
      if (!row._type?.endsWith('ReportHistoryDataRow/3774991779') || !request || source.g !== 'EE' ||
          source.p !== 'JAX' || source.s !== 'TRAINERS' || ![0, 1].includes(row.a))
        throw new Error('Unexpected report row type or context.');
      // Only the twelve report columns leave this function. No raw DTO, personnel
      // identity strings, credentials, response internals or source page HTML.
      return {
        status: row.a ? 'Inwork' : 'Accept', callId: String(source.e), certifier: text(source.i),
        aircraft: text(request.a), workOrder: text(request.R), trade: text(request.P),
        requestDate: formatDate(source.o), planner: text(request.F), examiner: text(row.i),
        inWorkDate: formatDate(row.g), responses: 'Responses', remarks: text(request.b)
      };
    });
    return { rows: snapshot(rows, 'rpc').rows, total: report.i };
  }
  function reportBody(origin, offset = 0, limit = 50) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('A same-origin HTTPS UCB page is required.');
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Invalid report page.');
    return `7|0|9|${origin}/Ucb/ucb_call_response/|BC3D0C4D0746C31A3747BD221F73967A|` +
      'mil.navy.ndms.ucb.gwt.common.shared.service.UcbReportService|executeReport|I|' +
      'mil.navy.ndms.ucb.gwt.common.shared.report.ReportExecutionContext/1449797842|JAX|TRAINERS|' +
      `java.util.ArrayList/4159755760|1|2|3|4|3|5|5|6|${offset}|${limit}|6|1|7|0|8|9|0|1|0|0|0|9|0|`;
  }
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64(str) {
    if (typeof str !== 'string' || !/^[A-Za-z0-9_-]+$/.test(str)) throw new Error('Invalid encoded data.');
    return Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - str.length % 4) % 4)), c => c.charCodeAt(0));
  }
  function pairingCode(input) {
    let code = text(input);
    if (code.startsWith('https://')) {
      const url = new URL(code);
      code = new URLSearchParams(url.hash.slice(1)).get('key') || '';
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || unb64(code).length !== 32 || b64(unb64(code)) !== code)
      throw new Error('Invalid private viewer link. Open the link printed by the UCB Console sender.');
    return code;
  }
  const makeCode = () => b64(crypto.getRandomValues(new Uint8Array(32)));
  const importKey = code => crypto.subtle.importKey('raw', unb64(pairingCode(code)), 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function encrypt(value, key, version) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(validateSnapshot(value)));
    if (plain.length > 450000) throw new Error('The report exceeds the single-chunk safety limit.');
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(version) }, key, plain);
    return JSON.stringify({ format: VERSION, iv: b64(iv), data: b64(new Uint8Array(data)) });
  }
  async function decrypt(envelope, key, version) {
    if (typeof envelope !== 'string' || envelope.length > 650000) throw new Error('Invalid encrypted snapshot.');
    const e = JSON.parse(envelope);
    if (e.format !== VERSION || typeof e.iv !== 'string' || unb64(e.iv).length !== 12 || typeof e.data !== 'string')
      throw new Error('Invalid encrypted snapshot format.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv),
      additionalData: new TextEncoder().encode(version) }, key, unb64(e.data));
    return validateSnapshot(JSON.parse(new TextDecoder().decode(plain)));
  }
  return { VERSION, TITLE, KEYS, MAX_ROWS, text, flat, snapshot, validateSnapshot, reportContext, parseDOM,
    decodeGwt, parseReport, reportBody, pairingCode, makeCode, importKey, encrypt, decrypt };
});

/* Bundled by build.cjs. Run console-sender.js, not this source file, in DevTools > top. */
(async function startUcbEyes() {
  'use strict';
  const C = globalThis.UcbEyesCore;
  const config = {
    intervalMs: 2000, // Supported range: 1000–3000 milliseconds. Never overlaps requests.
    sourceMode: 'rpc', // 'dom' explicitly mirrors only the visible page at UCB's own refresh rate.
    viewerUrl: 'https://jrdn-r.github.io/UCB-eyes/',
    apiKey: 'AIzaSyCtz99nbMN9caeFRnSct6NeugepWQORqvM', // Existing PUBLIC Firebase web configuration.
    projectId: 'ucb-eyes'
  };
  const TOP = window.top;
  if (window !== TOP) throw new Error('Select top in the DevTools Console context dropdown, then paste again.');
  if (!window.isSecureContext || !crypto?.subtle) throw new Error('HTTPS and Web Crypto are required.');
  if (!['rpc', 'dom'].includes(config.sourceMode)) throw new Error('Unknown source mode.');
  if (TOP.__UCB_EYES__?.running) TOP.__UCB_EYES__.stop();
  function findSource(win, seen = new Set()) {
    if (seen.has(win) || seen.size >= 40) return null;
    seen.add(win);
    try {
      if (C.reportContext(win.document)) return win;
      for (let i = 0; i < win.frames.length; i++) {
        const match = findSource(win.frames[i], seen);
        if (match) return match;
      }
    } catch { /* Cross-origin frames are intentionally inaccessible. */ }
    return null;
  }
  const source = findSource(TOP);
  if (!source) throw new Error('Open JAX / TRAINERS / E&E / Outstanding, then run this in top. Cross-origin frames cannot be read.');
  const sourceOrigin = source.location.origin;
  if (source.location.protocol !== 'https:') throw new Error('The UCB report must use HTTPS.');
  if (config.sourceMode === 'rpc') {
    const compatible = [...source.document.scripts].some(s => /5F3D96C6EB4F757767F1A4D73FF240A0\.cache\.js(?:\?|$)/.test(s.src));
    if (!compatible) throw new Error('This UCB build differs from the supplied HAR. Use sourceMode: "dom" or update the verified wire schemas.');
  }
  if (!TOP.confirm('Send this report to UCB Eyes?\n\nOnly the visible report columns are encrypted and sent to the existing ucb-eyes Firebase project. Your UCB login stays on the UCB origin.\n\nStop the old screen-capture sender first. Use this only if this destination and device are approved for the information.')) return;
  // No pairing prompt: silently reuse the tab's existing encryption key,
  // otherwise generate one for a private viewer link. Do not publish the key.
  let code = '';
  try {
    const saved = sessionStorage.getItem('ucb-eyes-sender-key-v1');
    if (saved) code = C.pairingCode(saved);
  } catch { /* Missing or damaged session storage: create a new private link. */ }
  if (!code) code = C.makeCode();
  const key = await C.importKey(code);
  try { sessionStorage.setItem('ucb-eyes-sender-key-v1', code); } catch {}
  const viewerUrl = config.viewerUrl + '#key=' + code;
  const interval = Math.min(3000, Math.max(1000, config.intervalMs));
  const sessionId = crypto.randomUUID();
  const root = `projects/${config.projectId}/databases/(default)/documents`;
  const currentName = root + '/live_capture/current';
  const chunkName = root + '/live_capture/current_chunk_0';
  const api = 'https://firestore.googleapis.com/v1/';
  const fetchCloud = TOP.fetch.bind(TOP);
  let running = true, timer, failures = 0, sequence = 0, fingerprint = '', version = '';
  let token = '', refreshToken = '', expiresAt = 0, lease = null, initialized = false;
  let lastSent = 0, lastError = '', lastRows = 0, inFlight = false;
  const controllers = new Set();
  function stop() {
    running = false; clearTimeout(timer);
    for (const controller of controllers) controller.abort();
    controllers.clear();
    token = ''; refreshToken = '';
    TOP.removeEventListener('pagehide', stop);
    console.info('[UCB Eyes] Sender stopped. The viewer will keep the last report and mark it stale.');
  }
  TOP.__UCB_EYES__ = {
    get running() { return running; }, stop, viewerUrl,
    status: () => ({ running, mode: config.sourceMode, intervalMs: interval, rows: lastRows,
      lastSent: lastSent ? new Date(lastSent).toLocaleTimeString() : null, error: lastError }),
    sendNow: () => { if (running && !inFlight) { clearTimeout(timer); void tick(); } }
  };
  TOP.addEventListener('pagehide', stop, { once: true });
  async function request(url, options = {}, useSource = false) {
    if (!running) throw new Error('Sender stopped.');
    const target = new URL(url);
    if (useSource && target.origin !== sourceOrigin) throw new Error('Refusing to forward the UCB session off-origin.');
    if (!useSource && !['firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com'].includes(target.hostname))
      throw new Error('Unexpected cloud destination.');
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const send = useSource ? source.fetch.bind(source) : fetchCloud;
      const response = await send(url, { ...options, signal: controller.signal, cache: 'no-store',
        credentials: useSource ? 'same-origin' : 'omit', mode: useSource ? 'same-origin' : 'cors',
        redirect: 'error', referrerPolicy: 'no-referrer' });
      // Keep the timeout and stop signal active through the entire response body.
      const body = await response.text();
      return { ok: response.ok, status: response.status,
        text: async () => body, json: async () => JSON.parse(body) };
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  async function firebaseAuth() {
    if (token && Date.now() < expiresAt - 60000) return;
    const refreshing = Boolean(refreshToken);
    const url = refreshing ? `https://securetoken.googleapis.com/v1/token?key=${config.apiKey}` :
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.apiKey}`;
    const response = await request(url, { method: 'POST',
      headers: { 'Content-Type': refreshing ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: refreshing ? new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString() :
        JSON.stringify({ returnSecureToken: true }) });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error('Firebase authentication failed. Check Anonymous Authentication and API-key restrictions.');
      error.fatal = response.status === 400 || response.status === 403;
      throw error;
    }
    token = data.idToken || data.id_token;
    refreshToken = data.refreshToken || data.refresh_token;
    expiresAt = Date.now() + Number(data.expiresIn || data.expires_in || 3600) * 1000;
    if (!token || !refreshToken) throw new Error('Firebase returned an incomplete sign-in.');
  }
  async function currentDocument() {
    const response = await request(api + currentName, { headers: { Authorization: 'Bearer ' + token } });
    if (response.status === 404) return null;
    if (!response.ok) { const error = new Error('Cannot read the UCB Eyes feed. Check Firestore rules.'); error.fatal = response.status === 403; throw error; }
    return response.json();
  }
  async function fetchReport() {
    if (source.closed || source.location.origin !== sourceOrigin || !C.reportContext(source.document))
      throw new Error('The source report was closed or changed. Return to the E&E Outstanding report.');
    if (config.sourceMode === 'dom') return C.parseDOM(source.document);
    const kc = source.keycloak;
    if (!kc?.authenticated || !kc.token) throw new Error('UCB is signed out. Sign in normally and reopen the report.');
    // Reuse the current user's existing session only for this same-origin read.
    // The Keycloak library's normal token refresh remains responsible for renewal.
    const rows = [], ids = new Set(); let total = null;
    for (let offset = 0, page = 0; page < 30; page++) {
      const response = await request(sourceOrigin + '/Ucb/ucbGwtRpcServices/UcbReportService', {
        method: 'POST', headers: { 'Content-Type': 'text/x-gwt-rpc; charset=UTF-8',
          'X-GWT-Module-Base': sourceOrigin + '/Ucb/ucb_call_response/',
          'X-GWT-Permutation': '5F3D96C6EB4F757767F1A4D73FF240A0', Authorization: 'Bearer ' + kc.token },
        body: C.reportBody(sourceOrigin, offset, 50)
      }, true);
      if (!response.ok) throw new Error(`UCB report read failed (HTTP ${response.status}). Check the source session.`);
      const result = C.parseReport(await response.text());
      if (total !== null && total !== result.total) throw new Error('The report changed while paging. Retrying a complete snapshot.');
      total = result.total;
      for (const row of result.rows) {
        if (ids.has(row.callId)) throw new Error('The report shifted while paging. Retrying without mixing pages.');
        ids.add(row.callId); rows.push(row);
      }
      if (rows.length === total) return C.snapshot(rows, 'rpc');
      if (!result.rows.length || rows.length > total) throw new Error('Incomplete UCB report. The previous snapshot was retained.');
      offset += result.rows.length;
    }
    throw new Error('Report page limit reached. No partial snapshot was sent.');
  }
  async function publish(snapshot) {
    await firebaseAuth();
    if (!initialized) { const doc = await currentDocument(); lease = doc?.updateTime || null; initialized = true; }
    const nextFingerprint = JSON.stringify(snapshot);
    const changed = nextFingerprint !== fingerprint;
    const nextVersion = changed ? `${C.VERSION}.${sessionId}.${++sequence}` : version;
    const fields = { version: { stringValue: nextVersion }, chunkCount: { integerValue: '1' } };
    const writes = [];
    if (changed) writes.push({ update: { name: chunkName, fields: {
      version: { stringValue: nextVersion }, data: { stringValue: await C.encrypt(snapshot, key, nextVersion) }
    } } });
    writes.push({ update: { name: currentName, fields },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: lease ? { updateTime: lease } : { exists: false } });
    const response = await request(api + root + ':commit', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ writes }) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (['FAILED_PRECONDITION', 'ABORTED'].includes(data.error?.status)) {
        const doc = await currentDocument();
        // A lost acknowledgement can leave our own write committed. Adopt only our
        // exact attempted version. Never compete silently with another publisher.
        if (doc?.fields?.version?.stringValue === nextVersion) {
          lease = doc.updateTime;
        } else {
          const error = new Error('Another publisher changed the feed. Stop the old sender, then paste this script again.');
          error.fatal = true; throw error;
        }
      } else {
        if (response.status === 401) expiresAt = 0;
        const error = new Error(`UCB Eyes write failed (HTTP ${response.status}). Check Firestore rules, quota and network access.`);
        error.fatal = response.status === 403;
        throw error;
      }
    } else {
      const result = await response.json();
      lease = result.writeResults?.at(-1)?.updateTime;
      if (!lease) throw new Error('Firebase did not acknowledge the completed snapshot.');
    }
    fingerprint = nextFingerprint; version = nextVersion; lastRows = snapshot.rows.length; lastSent = Date.now();
  }
  async function tick() {
    if (!running || inFlight) return;
    inFlight = true;
    const start = Date.now();
    let delay = interval;
    try {
      const snapshot = await fetchReport();
      if (!running) return;
      await publish(snapshot);
      if (failures) console.info('[UCB Eyes] Connection restored.');
      failures = 0; lastError = '';
      delay = Math.max(100, interval - (Date.now() - start));
    } catch (error) {
      if (!running) return;
      failures++;
      const message = error.name === 'AbortError' ? 'Request timed out. Retrying; the viewer retains the last good report.' : error.message;
      if (message !== lastError) console.warn('[UCB Eyes] ' + message);
      lastError = message;
      // No fake heartbeat after a failed source read or failed upload.
      delay = Math.min(30000, interval * 2 ** Math.min(failures - 1, 4));
      if (error.fatal) { stop(); return; }
    } finally {
      inFlight = false;
      if (running) timer = setTimeout(tick, delay);
    }
  }
  console.info('[UCB Eyes] Ready. Keep this UCB tab open and the computer awake.');
  console.info('Private iPhone viewer link (open on an approved device; keep private):\n' + viewerUrl);
  console.info('No code to enter. Open the private link on your iPhone. It reconnects automatically in this browser session.');
  console.info('Stop: __UCB_EYES__.stop()   Status: __UCB_EYES__.status()');
  if (config.sourceMode === 'dom') console.warn('[UCB Eyes] DOM mode sends only the displayed page. It does not accelerate UCB’s own refresh.');
  await tick();
})().catch(error => console.error('[UCB Eyes] ' + error.message));

})();
