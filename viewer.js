import './ucb-core.js';
import './view-model.js?v=compact-3';
import './board.js?v=compact-3';
const C = globalThis.UcbEyesCore;
const $ = id => document.getElementById(id);
const board = new globalThis.UcbEyesBoard();
const firebaseConfig = {
  apiKey: 'AIzaSyCtz99nbMN9caeFRnSct6NeugepWQORqvM',
  authDomain: 'ucb-eyes.firebaseapp.com', projectId: 'ucb-eyes',
  storageBucket: 'ucb-eyes.firebasestorage.app', messagingSenderId: '460479225138',
  appId: '1:460479225138:web:9901e6ae32943663d1cb2b'
};
let servicesPromise, unsubscribe, refresh, generation = 0;
let code = '', key = null, currentVersion = '', lastReceived = 0, sourcePublished = 0;
let lastStamp = 0, errorMessage = '', mode = 'rpc', isDemo = false, feedNotice = '';
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Feed read timed out')), 15000);
  })]); } finally { clearTimeout(timer); }
}
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function setText(id, value) { if ($(id).textContent !== value) $(id).textContent = value; }
function state(type, label) {
  if ($('connection').dataset.state !== type) $('connection').dataset.state = type;
  setText('connectionText', label);
}
function notice(message) { setText('notice', message); $('notice').hidden = !message; }
function health() {
  if (isDemo) return;
  if (!code) { state('waiting', 'Not paired'); return; }
  if (!navigator.onLine) { state('error', 'Offline'); notice('You are offline. The last report remains readable.'); return; }
  if (errorMessage) { state('error', 'Not connected'); notice(errorMessage); return; }
  if (feedNotice) { state('waiting', 'Waiting for text'); notice(feedNotice); return; }
  if (!lastReceived) { state('waiting', 'Waiting for sender'); return; }
  const age = Math.max(Date.now() - lastReceived, sourcePublished ? Date.now() - sourcePublished : 0);
  if (age > 15000) { state('stale', 'Paused'); notice('No recent source update. Showing the last received report.'); }
  else if (age > 6500) { state('delayed', 'Delayed'); notice('The next source update has not arrived yet.'); }
  else {
    state('live', mode === 'dom' ? 'Page mirror' : 'Live');
    notice(mode === 'dom' ? 'Visible-page mirror. UCB’s own refresh controls source freshness; other pages are not included.' : '');
  }
}
function received(meta, receiptTime) {
  if (meta.stamp <= lastStamp) return; // Cached/repeated observations do not invent updates.
  lastStamp = meta.stamp; sourcePublished = meta.stamp; lastReceived = receiptTime;
  setText('receivedTime', clock.format(lastReceived));
  $('receivedTime').dateTime = new Date(lastReceived).toISOString();
  $('receivedTime').title = new Date(lastReceived).toLocaleString();
  errorMessage = ''; health();
}
async function firebaseServices() {
  if (!servicesPromise) servicesPromise = (async () => {
    const [appSdk, authSdk, fs] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js')
    ]);
    const app = appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    if (!auth.currentUser) await authSdk.signInAnonymously(auth);
    return { fs, db: fs.getFirestore(app) };
  })().catch(error => { servicesPromise = null; throw error; });
  return servicesPromise;
}
function friendlyError(error) {
  if (String(error?.code).includes('permission-denied')) return 'Firestore denied access. Check the existing UCB Eyes rules and sender permissions.';
  if (String(error?.code).includes('auth/')) return 'Firebase sign-in failed. Check Anonymous Authentication and the project configuration.';
  if (error?.name === 'OperationError') return 'This pairing code cannot decrypt the feed. Use the code from the active sender.';
  return error?.message === 'Chunk version mismatch' ? 'A new report is arriving. The last complete report is retained.' :
    'The feed could not be read. Check the sender, pairing code and network connection.';
}
async function connect(input) {
  const newCode = C.pairingCode(input), newKey = await C.importKey(newCode);
  const myGeneration = ++generation;
  unsubscribe?.(); refresh = null;
  code = newCode; key = newKey; isDemo = false;
  currentVersion = ''; lastReceived = 0; sourcePublished = 0; lastStamp = 0; errorMessage = ''; feedNotice = '';
  board.clear(); setText('receivedTime', '—'); notice(''); health();
  try { sessionStorage.setItem('ucb-eyes-viewer-key-v1', code); } catch {}
  $('copyLink').disabled = false; $('forgetDevice').disabled = false;
  const { fs, db } = await firebaseServices();
  if (myGeneration !== generation) return;
  const currentRef = fs.doc(db, 'live_capture', 'current');
  const chunkRef = fs.doc(db, 'live_capture', 'current_chunk_0');
  let latest = null, processing = false, listening = false;
  async function drain() {
    if (processing) return;
    processing = true;
    try {
      while (latest && myGeneration === generation) {
        const job = latest; latest = null;
        try {
          if (job.version !== currentVersion) {
            let chunk;
            for (let attempt = 0; attempt < 4; attempt++) {
              const snap = await bounded(fs.getDocFromServer(chunkRef));
              if (myGeneration !== generation) return;
              if (latest && latest.version !== job.version) break;
              chunk = snap.exists() ? snap.data() : null;
              if (chunk?.version === job.version) break;
              if (attempt < 3) await pause(150 * 2 ** attempt);
            }
            if (latest && latest.version !== job.version) continue;
            if (chunk?.version !== job.version) throw new Error('Chunk version mismatch');
            const value = await C.decrypt(chunk.data, newKey, job.version);
            if (myGeneration !== generation) return;
            if (latest && latest.version !== job.version) continue;
            mode = value.mode; board.set(value); currentVersion = job.version;
          }
          if (myGeneration === generation) received(job, job.receiptTime);
        } catch (error) {
          if (myGeneration === generation) { errorMessage = friendlyError(error); health(); }
        }
      }
    } finally { processing = false; }
  }
  function accept(snap) {
    if (myGeneration !== generation) return;
    if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) return; // Not a newly received server update.
    if (!snap.exists()) { feedNotice = 'The text sender has not published a report yet.'; latest = null; health(); return; }
    const data = snap.data();
    if (typeof data.version !== 'string' || !data.version.startsWith(C.VERSION + '.')) {
      feedNotice = 'The original screen feed is active. Start the text sender, or open the original screen viewer in settings.';
      latest = null; health(); return;
    }
    feedNotice = '';
    const stamp = data.updatedAt?.toMillis?.();
    if (data.chunkCount !== 1 || !Number.isFinite(stamp)) {
      errorMessage = 'The sender metadata is incomplete. The last complete report is retained.'; health(); return;
    }
    latest = { version: data.version, stamp, receiptTime: Date.now() };
    void drain();
  }
  function listen() {
    unsubscribe?.();
    listening = true;
    unsubscribe = fs.onSnapshot(currentRef, { includeMetadataChanges: true }, accept, error => {
      listening = false;
      if (myGeneration === generation) { errorMessage = friendlyError(error); health(); }
    });
  }
  refresh = async () => {
    if (myGeneration !== generation || !navigator.onLine) return;
    try {
      if (!listening) listen();
      accept(await bounded(fs.getDocFromServer(currentRef)));
    }
    catch (error) { if (myGeneration === generation) { errorMessage = friendlyError(error); health(); } }
  };
  listen();
}
function showSettings() { $('pairCode').value = code; $('pairError').textContent = ''; $('settingsDialog').showModal(); }
$('settingsButton').addEventListener('click', showSettings);
$('pairButton').addEventListener('click', showSettings);
$('closeSettings').addEventListener('click', () => $('settingsDialog').close());
$('pairForm').addEventListener('submit', async event => {
  event.preventDefault(); $('pairError').textContent = '';
  try {
    // Validate synchronously; Firebase initialization may finish after the dialog closes.
    const input = C.pairingCode($('pairCode').value);
    $('settingsDialog').close();
    await connect(input);
  } catch (error) {
    errorMessage = error.message || friendlyError(error); health();
    $('pairError').textContent = errorMessage;
    if (!$('settingsDialog').open) $('settingsDialog').showModal();
  }
});
$('copyLink').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(new URL('./', location.href).href.split('#')[0].split('?')[0] + '#key=' + code); globalThis.ucbToast('Private viewer link copied.'); }
  catch { globalThis.ucbToast('Copy the pairing code from settings instead.'); }
});
$('forgetDevice').addEventListener('click', () => {
  ++generation; unsubscribe?.(); unsubscribe = null; refresh = null;
  code = ''; key = null; lastReceived = 0; currentVersion = ''; lastStamp = 0; errorMessage = ''; feedNotice = ''; isDemo = false;
  try { sessionStorage.removeItem('ucb-eyes-viewer-key-v1'); } catch {}
  history.replaceState(null, '', location.pathname);
  board.clear(); $('pairCode').value = ''; $('copyLink').disabled = true; $('forgetDevice').disabled = true;
  setText('receivedTime', '—'); notice(''); health(); globalThis.ucbToast('This device is no longer paired.');
});
$('copySender').addEventListener('click', async () => {
  try {
    const response = await fetch('./console-sender.js', { cache: 'no-store' });
    if (!response.ok) throw new Error('Download failed');
    const script = await response.text();
    try { await navigator.clipboard.writeText(script); globalThis.ucbToast('Console script copied. Paste it in the UCB top Console.'); }
    catch { $('scriptFallback').value = script; $('scriptFallback').hidden = false; $('scriptFallback').focus(); $('scriptFallback').select(); }
  } catch { globalThis.ucbToast('Use Download script below the copy button.'); }
});
window.addEventListener('online', () => { health(); void refresh?.(); });
window.addEventListener('offline', health);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { health(); void refresh?.(); } });
window.addEventListener('pageshow', () => { health(); void refresh?.(); });
setInterval(health, 1000); // Only changes state when needed. Never advances the received time.

const params = new URLSearchParams(location.search);
if (params.get('demo') === '1') {
  isDemo = true;
  const example = (id, aircraft, status, remarks) => ({ status, callId: id, certifier: 'SAMPLE CERTIFIER',
    aircraft, workOrder: '0000' + id, trade: 'METALS', requestDate: '10/13/2026 12:14 PM',
    planner: 'ZZ', examiner: status === 'Inwork' ? 'SAMPLE EXAMINER' : '', inWorkDate: '', responses: 'Responses', remarks });
  board.set(C.snapshot([
    example('1001', 'DEMO-01', 'Inwork', 'EXAMPLE ONLY.\nA request’s complete remarks appear here as selectable text.'),
    example('1002', 'DEMO-02', 'Accept', 'EXAMPLE ONLY.\nWork orders, names and request details can be selected and copied.')
  ], 'rpc'));
  state('waiting', 'Design preview'); notice('Example data only. This preview is not connected to UCB or Firebase.');
} else {
  const fragment = new URLSearchParams(location.hash.slice(1));
  let stored = ''; try { stored = sessionStorage.getItem('ucb-eyes-viewer-key-v1') || ''; } catch {}
  const initial = fragment.get('key') || stored;
  if (fragment.has('key')) history.replaceState(null, '', location.pathname + location.search);
  if (initial) connect(initial).catch(error => { errorMessage = friendlyError(error); health(); });
}
