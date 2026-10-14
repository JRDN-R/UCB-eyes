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
