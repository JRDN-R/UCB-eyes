import './ucb-core.js';
import './public-feed.js';
import './view-model.js?v=compact-3';
import './board.js?v=compact-3';
const C = globalThis.UcbEyesCore;
const P = globalThis.UcbEyesPublic;
const $ = id => document.getElementById(id);
const board = new globalThis.UcbEyesBoard();
const firebaseConfig = {
  apiKey: 'AIzaSyCtz99nbMN9caeFRnSct6NeugepWQORqvM',
  authDomain: 'ucb-eyes.firebaseapp.com', projectId: 'ucb-eyes',
  storageBucket: 'ucb-eyes.firebasestorage.app', messagingSenderId: '460479225138',
  appId: '1:460479225138:web:9901e6ae32943663d1cb2b'
};
let servicesPromise, unsubscribe, refresh, generation = 0;
let currentVersion = '', lastReceived = 0, sourcePublished = 0;
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
function expire(message = 'The source feed stopped or expired. Start the read-only sender to resume.') {
  if (board.hasData) board.clear();
  currentVersion = ''; lastReceived = 0; lastStamp = 0; sourcePublished = 0;
  setText('receivedTime', '—');
  feedNotice = message;
  state('waiting', 'No live feed'); notice(message);
}
function health() {
  if (isDemo) return;
  if (lastReceived && !P.fresh(sourcePublished)) { expire(); return; }
  if (!navigator.onLine) { state('error', 'Offline'); notice('You are offline.'); return; }
  if (errorMessage) { state('error', 'Not connected'); notice(errorMessage); return; }
  if (feedNotice) { state('waiting', 'No live feed'); notice(feedNotice); return; }
  if (!lastReceived) { state('waiting', 'Waiting for sender'); return; }
  const age = Math.max(Date.now() - lastReceived, Date.now() - sourcePublished);
  if (age > 6500) { state('delayed', 'Delayed'); notice('The next source update has not arrived yet.'); }
  else {
    state('live', mode === 'dom' ? 'Page mirror' : 'Live');
    notice(mode === 'dom' ? 'Visible-page mirror only; other report pages are not included.' : '');
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
  return error?.message === 'Chunk version mismatch' ? 'A new report is arriving. The last complete report is retained.' :
    'The public report could not be read. Check the sender, Firestore permissions and network.';
}
async function connect() {
  const myGeneration = ++generation;
  unsubscribe?.(); refresh = null;
  isDemo = false;
  currentVersion = ''; lastReceived = 0; sourcePublished = 0; lastStamp = 0; errorMessage = ''; feedNotice = '';
  board.clear(); setText('receivedTime', '—'); notice(''); health();
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
            if (!P.fresh(job.stamp)) { expire(); return; }
            const value = P.decode(chunk.data);
            if (myGeneration !== generation) return;
            if (latest && latest.version !== job.version) continue;
            mode = value.mode; board.set(value); currentVersion = job.version;
          }
          if (myGeneration === generation && P.fresh(job.stamp)) received(job, job.receiptTime);
        } catch (error) {
          if (myGeneration === generation) { errorMessage = friendlyError(error); health(); }
        }
      }
    } finally { processing = false; }
  }
  function accept(snap) {
    if (myGeneration !== generation) return;
    if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) return; // Not a newly received server update.
    if (!snap.exists()) { expire('No active public report. Start the sender in UCB.'); latest = null; return; }
    const data = snap.data();
    if (typeof data.version !== 'string' || !data.version.startsWith(P.VERSION + '.')) {
      expire('The previous private-link sender is still active. Start the updated public read-only sender.');
      latest = null; return;
    }
    feedNotice = '';
    const stamp = data.updatedAt?.toMillis?.();
    if (data.chunkCount !== 1 || !Number.isFinite(stamp)) {
      errorMessage = 'The sender metadata is incomplete. The last complete report is retained.'; health(); return;
    }
    if (!P.fresh(stamp)) { expire(); latest = null; return; }
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
function showSettings() { $('settingsDialog').showModal(); }
$('settingsButton').addEventListener('click', showSettings);
$('pairButton').addEventListener('click', showSettings);
$('closeSettings').addEventListener('click', () => $('settingsDialog').close());
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
  // Legacy private-link fragments no longer unlock the report.
  if (new URLSearchParams(location.hash.slice(1)).has('key'))
    history.replaceState(null, '', location.pathname + location.search);
  connect().catch(error => { errorMessage = friendlyError(error); health(); });
}
