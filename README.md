# UCB Eyes · Public read-only live report

UCB Eyes displays the **JAX / TRAINERS / E&E Outstanding Report** at the
ordinary URL, with no passcode, private link, invitation, or account prompt:

**https://jrdn-r.github.io/UCB-eyes/**

The public viewer cannot accept, modify, reply to, or close UCB calls.
The earlier remote Accept controls and their control bridge are not included.

## Start the source sender

1. On the approved source work computer, open the **JAX → TRAINERS → E&E → Outstanding** report in your existing authenticated UCB session.
2. Stop any older sender and control add-on. In the UCB top Console, use
   `window.__UCB_EYES_CONTROLS__?.stop()` if you previously installed the old remote Accept feature. Stop an older report sender using `await window.__UCB_EYES__?.stop()`.
3. Open DevTools → Console → **top**. Paste **[console-sender.js](console-sender.js)** from this current repository (or copy it using Settings on the website). Confirm that publishing this report to the existing Firebase destination is authorized.
4. Visit **https://jrdn-r.github.io/UCB-eyes/** on any approved browser. The live report loads automatically; **no key-bearing URL** or manual authentication is needed.

Keep the source computer awake, its UCB report open, and its source session authenticated. A reload or navigation of the source UCB page stops the Console sender and requires running it again. The sender targets a two-second read/heartbeat cadence but cannot guarantee it under browser throttling, source delays, or network errors.

Console controls:

```js
__UCB_EYES__.status()        // Show feed status
__UCB_EYES__.sendNow()       // Poll UCB as soon as possible
await __UCB_EYES__.stop()    // Stop; attempt to delete the current Firebase snapshot
```

## Behavior on the website

- The homepage immediately subscribes to the public text feed using an automatically established, anonymous Firebase transport session. There is no pairing step or password field.
- The original **twelve** report columns are preserved, with aircraft, work order, status, certifier, assigned E&E examiner, trade, and a selectable remarks preview in compact iOS cards. Expand any card for full remarks and metadata.
- A populated E&E examiner name makes the displayed status **Inwork** even if UCB's action label says **Accept**. This affects display counts and filters only; the UCB record is not changed.
- Calls assigned to **JORDAN RAPP** in the E&E field are highlighted deep teal. Mentioning that name in remarks or the certifier field does not trigger the highlight.
- The trade selector defaults to **Metals + Paint first**, with options for **Metals + Paint only** and **All trades · original order**. Status and trade filters operate together.
- Unchanged heartbeats do not redraw selectable text, and updated records wait while text is selected.
- A quiet **Received HH:MM:SS** timestamp marks the last successfully processed source update, with no countdown or flashing indicator.

**Temporary on-screen availability:** The viewer checks Firestore's server-generated
`updatedAt` field. After **30 seconds without a successful source update**,
the viewer removes the records from its DOM and shows a No live feed message.
It does not keep presenting old records as if they were current. When new
heartbeats arrive, the report reloads without re-pairing or refreshing the page.
This is an on-screen expiry window, not a Firestore data-retention guarantee.

## Data handling and Firebase rules

**This is intentionally a publicly readable feed**, based on explicit approval
for unrestricted viewing. Report data is stored in Firebase as validated JSON,
**not encrypted with a secret viewer key**. Any viewer allowed to access the
report documents can read the rows and may be able to retain their own copy.
TLS still protects network transport. Do not describe this feed as confidential.

The sender keeps the existing document paths:

- `live_capture/current` — current version, chunk count, server-generated `updatedAt`.
- `live_capture/current_chunk_0` — the matching version and JSON report under `data`.

Version prefix: `ucb-public-v1.` (the old `ucb-text-v1.` encrypted private-link feed is intentionally not accepted by the updated public viewer). The source UCB token is used only in same-origin read-only UCB report requests and is never included in the published report JSON or Firebase requests.

The viewer does **not** write to UCB or send remote commands. Public viewing
does not authorize public publishing: **Firestore security rules must restrict
writes to an approved publisher identity**, while granting whatever read
access is explicitly approved. Anonymous Firebase sign-in by itself does
not establish a person or device's authorization. This repository does not
contain or deploy Firestore rules, and it does not grant more permissive
Firebase access. Do not work around a 403 by broadly allowing public writes.
An authorized Firebase administrator should verify the existing rules and
App Check configuration before live use.

On an explicit normal stop, the sender attempts to delete the current chunk and
metadata in a single Firestore commit protected by the last known metadata
update time. **Deletion is best effort**: denied deletes, tab crashes, network
loss, and browser shutdown can leave the last JSON snapshot stored in Firebase
even after the website hides it. Configure a suitable server-side retention /
deletion policy and confirm its operation if storage must also be temporary.
An in-browser expiry is not equivalent to guaranteed server-side deletion.

The existing screenshot viewer remains available at `screen.html` for historical
use; it is not required for the new public text feed. Do not run the old screen
publisher or old encrypted text publisher simultaneously with this sender.

## Development

The static viewer uses plain HTML/CSS/JavaScript and the Firebase Web SDK.
The standalone top-Console script is built from shared source files:

```bash
node build.cjs
node --test tests/*.test.cjs
```

The `public-feed.js` module validates report shape and payload size and
contains the 30-second freshness rule. Tests use only synthetic report rows.
Offline Chromium checks cover homepage display without a key, record expiry
and resumption. The build/deployment does not validate live Navy network
access, Firestore rule configuration, or the physical iOS browser.

An **offline synthetic demonstration only** is available at `?demo=1`.
It displays fabricated records and never contacts Firebase.
