# UCB Eyes · Text edition

A mobile-first E&E Outstanding report viewer, read-only by default, with selectable text, two-second source polling, and a quiet last-received time. The original screenshot viewer is preserved at `screen.html`.

## Start the feed

1. Stop the old screen-capture publisher. On the source computer, open **JAX → TRAINERS → E&E → Outstanding** in the existing, authenticated UCB session.
2. Open DevTools → **Console**, choose **top**, and paste the complete contents of **[console-sender.js](console-sender.js)**. The viewer's Settings → **Copy console script** now copies that sender followed by the optional control bridge (installed but OFF until approved). No extension, local server, remote code loader or installation is required for the sender.
3. Read the destination confirmation. Enter an existing pairing code, or leave the prompt blank to generate one. Open the **private iPhone viewer link** printed in the console on your approved mobile device. Alternatively, open the viewer and paste the pairing code into Settings.

The unpaired public page contains no live report text. The private link contains the decryption key; treat it as a secret and share it only with approved recipients. The viewer removes the key from the address bar after reading it and keeps it in tab-scoped session storage, not persistent local storage. A new tab or expired browser session may require pairing again. Keep the code privately to reuse the same pairing on another day. **Forget this device** clears the active viewer and its saved tab key; it does not revoke other devices. Generate a new sender code to rotate access to future updates.

Console controls:

```js
__UCB_EYES__.status()
__UCB_EYES__.sendNow()
__UCB_EYES__.stop()
```

The source tab must remain open, signed in and running on an awake computer. A console script is removed by a full page navigation or reload; paste it again afterward. Browser sleep, background throttling, network delay, server load and retries can make delivery slower than two seconds. Safari reconnects on return to the page. The displayed time advances only after a complete, server-confirmed incoming text update, not with the local clock or a repeated cache read.

## Optional Accept controls

The phone can now request **one individually confirmed call**. The source browser runs the exact supplied UI sequence:

1. Locate the selected **Call ID**, recheck the live report, then click its visible `span.staticlinkblue[usertext="Accept"]`.
2. Wait **at least 2 seconds**. Wait longer, up to a bounded timeout, for the correct call detail page and its Return toolbar. Verify the detail page's **Call ID**, then click **Return**.
3. Wait **at least 1 second**, then wait for the distinct **Continue / Cancel** toolbar and click **Continue**.
4. Wait for the Outstanding report, read fresh report data, and report success only if that same call, aircraft and work order are **Inwork under the signed-in examiner**.

No “accept all” operation, automatic acceptance of new arrivals, direct write-RPC replay, arbitrary selector, remote JavaScript, work-order certification, or work-order closure is supported. Source buttons retain UCB's own permission and availability checks. The new capture established `canCallBeAccepted` followed by `getCallResponseData`, and a later report showed the selected call changing from Accept/unassigned to Inwork. Those are observations, not a license to replay captured authentication or acceptance payloads.

### Approve controls

On the phone, refresh UCB Eyes and open **Settings → Accept calls → Create control code → Copy control code**. This is an independent random 256-bit secret, not your viewing key, Navy password or CAC PIN.

On the source PC, keep the existing sender running and paste **[console-controls.js](console-controls.js)** into the same **top** Console. Alternatively, copy the updated combined script from Settings and run it instead of the old sender. Installing the bridge does not accept a call. Then run:

```js
__UCB_EYES_CONTROLS__.enable()
```

Paste the **control** code from the phone and approve the named source examiner. Controls remain bound to that authenticated source user and document. Approval expires after at most eight hours and is invalidated by a sender restart, page navigation, sign-out, user change, disabling controls, or a new approval. Source credentials are used only in same-origin report reads; the UI itself sends any acceptance requests.

After approval, tap a call's **Accept call** button on the phone and confirm its aircraft, work order, Call ID and examiner. Return and Continue require no additional phone taps. The source PC must be awake and remain on the report. Do not manually interact with its UCB page during the sequence: a trusted pointer/key event stops further automation to avoid clicking through a different screen.

**Page scope:** The button is enabled only for a call whose Accept link exists on the current loaded source page. This version does not auto-page, reconstruct unseen rows, or invent an acceptance endpoint. Open the desired report page on the source PC when necessary. The sender's all-page *viewing* capability is unchanged.

```js
__UCB_EYES_CONTROLS__.status()   // Progress and approval state, without secrets.
__UCB_EYES_CONTROLS__.disable()  // Immediately revoke execution permission.
__UCB_EYES_CONTROLS__.stop()     // Stop the optional bridge entirely.
```

Stopping cannot undo a click already sent. After a timeout, interrupted workflow or unverified result, controls halt and **do not retry the call automatically**. Inspect the call and return to the Outstanding report manually, then explicitly resume with `__UCB_EYES_CONTROLS__.resume()`. No old command is replayed. Ambiguous uploads remain pending on the phone; the recovery control tells you to disable the source bridge and check UCB before clearing that pending message.

### Control security and Firebase access

Viewing access alone cannot authenticate commands or decrypt action results. Commands and results use the separate control key, AES-GCM, and authenticated direction/session context. Each command has an unpredictable ID, a 30-second start deadline, the source approval session, exact identifiers and a fingerprint of all twelve report columns. The source consumes command IDs before any source read/click, keeps them for that approval session, checks the current examiner and row, and executes only one workflow at a time. A new approval generates a new session nonce. These are bearer-code controls, **not organization-managed person/device authentication**: anyone given the control secret and necessary feed access can use that approved session. Keep the code private and use one controlling browser tab.

The optional bridge uses these additional documents in the existing project:

- `live_capture/control_info`: source readiness and approval metadata, encrypted with the viewing key.
- `live_capture/control_request_<session UUID>`: one encrypted command mailbox per approval session.
- `live_capture/control_result_<session UUID>`: encrypted progress/result for that session.

The bridge polls approximately every 1.5 seconds when idle and publishes readiness at most every five seconds unless state changes. Source UI/network timing may add delays. The phone's existing Received time still belongs to incoming report snapshots, not control progress. While a selected call is being processed the previous report stays readable.

**No Firestore rules were deployed or loosened.** These documents must be permitted by your approved access policy. A permission error leaves acceptance unavailable; it must not be “fixed” by opening the whole database. An authorized administrator should restrict command writes to approved controllers and metadata/result writes to approved publishers; anonymous sign-in is transport identity, not proof of the human user's authority. Historical control documents contain encrypted messages and may need an administrator-managed retention policy. Organizational approval for government data, external cloud transport, remote writes and mobile devices is still required. None is established by this code or its encryption.

The control code is kept in the phone tab's session storage and source memory; it is not uploaded or added to viewer URLs. Forgetting the device clears its local codes, but does not revoke codes copied elsewhere. Disable controls on the source to revoke the current approval immediately.

### Control tests

`node --test tests/*.test.cjs` now runs **22 passing tests** including native Web Crypto round trips, wrong-key/direction/session rejection, altered/expired commands and field fingerprints. There are also **20 offline Chromium checks** for the exact button path/timing, slow pages, wrong detail IDs, missing buttons, stale data, another examiner, aborts, replay, credential isolation, disabled-by-default controls and mobile confirmation state.

```sh
python tests/browser_checks.py flow
python tests/browser_checks.py agent
python tests/browser_viewer_checks.py
```

The browser checks require Python Playwright, cryptography and Chromium. They use synthetic documents, network callbacks and a browser crypto adapter; native crypto is covered separately by Node. No actual UCB calls or Firebase records were changed during testing. Real UCB execution, physical iPhone Safari, network policy and deployed Firebase rules remain environment checks.

## What changed

- Native portrait-friendly cards, light/dark appearance, iOS safe-area spacing, readable wrapping and ordinary text selection. No forced landscape, screenshot-only text or zoom restrictions.
- Aircraft and work order up front, complete remarks, certifier and examiner, with Call ID, trade, planner and original request/in-work dates in expandable details. Work orders also have a copy button.
- Search across all twelve report fields; All / Accept / Inwork filters. The status filters are read-only labels. The separate Accept call action requires explicit source approval.
- Stable cards and text nodes: unchanged updates do not replace the board. Changed data waits while report text is selected. Existing expanded details remain open.
- No countdown, pulsing status, flashing timestamps or per-refresh loading animation. Delayed/Paused/Offline labels retain the last readable report.
- Empty reports are distinguished from failed reads, partial redraws and wrong report contexts. Response-history contents are not part of the supplied table; open UCB itself to read them.

## Source acquisition

The supplied HAR uses GWT `UcbReportService.executeReport`, not a JSON REST report endpoint. It also reports a built-in page refresh interval of 180 seconds. Merely copying the DOM every two seconds would not make that underlying source fresher.

The default sender therefore performs the verified **read-only report RPC** approximately every **2000 ms**, using the current source tab's existing session. It does not accept calls, update statuses, click controls or modify the UCB page. It reads pages sequentially, checks totals and duplicate IDs, then publishes a complete snapshot. Overlapping requests are prevented, request bodies have timeouts, and failures back off without sending fake fresh-data heartbeats.

The wire decoder is deliberately restricted to the supplied GWT permutation and verified serializer signatures. It parses data without `eval` or executing response JavaScript. An incompatible UCB release is rejected rather than guessed. Original remarks, spelling, work order strings and source date formatting are preserved. Only the report columns leave the decoder; source credentials, raw DTOs and internal identity fields do not.

In `src/sender.js`, `sourceMode: 'dom'` is an explicit alternative that mirrors only the displayed page. It handles separate header/body tables and pairs both physical rows by `cst_row_index` and `customindex`. **DOM mode does not accelerate UCB's own refresh and does not include unseen pages**; the viewer labels it Page mirror. Rebuild after changing this setting, or edit the same setting in the bundled console script.

## Encryption, destination and Firebase requirements

The report is encrypted in the source browser using AES-GCM with a randomly generated 256-bit key and a fresh nonce. The snapshot version is authenticated with the ciphertext. The key and UCB authentication token are never uploaded by this sender. The current UCB token is used only for a same-origin UCB request. Cloud requests use a separate Firebase identity, omit browser cookies, refuse redirects and suppress the referrer.

The existing Firebase project configuration and document paths are retained:

- `live_capture/current`: version, chunk count and server-generated `updatedAt`.
- `live_capture/current_chunk_0`: matching version and encrypted JSON envelope in `data`.

Changed snapshots atomically write the chunk and metadata. Unchanged successful polls write only the metadata heartbeat. The viewer listens to metadata and reads/decrypts the chunk only when the version changes. Publisher preconditions detect a competing writer instead of silently racing it. This is a **single-feed design**: do not run the legacy screenshot sender and the text sender together. `screen.html` remains available for the old publisher but cannot display the encrypted text feed.

Anonymous Authentication must be enabled and the existing Firestore rules must permit the authenticated sender/viewer to access those documents. The Firebase public web API key is configuration, not a secret. Anonymous sign-in is **not** a personal access-control boundary; report confidentiality here depends on keeping the pairing key private. This update does not deploy or loosen Firestore rules. It does not verify that your Firebase destination, account, network or mobile device is approved for government information. Obtain the necessary authorization before use; encryption is not a substitute for it.

No report records, raw HAR/HTML captures, SSO tokens or captured personnel details are committed. HAR exports can contain credentials even when their cookie lists appear empty. Handle originals privately. If a capture was shared outside a trusted environment, follow your organization's session-revocation/incident procedures.

Network/CSP or managed-device policies may block outbound Firebase connections. The script reports the failure and preserves the last report. Do not disable browser security or organizational controls to make it work. A two-second heartbeat is approximately 14,400 metadata writes during eight uninterrupted hours, plus changed-snapshot writes and viewer reads; monitor the existing project's usage and quotas.

## Development and checks

No npm dependencies are required for the source bundle or Node tests:

```sh
node build.cjs
node --test tests/*.test.cjs
```

`console-sender.js` is generated from `ucb-core.js` and `src/sender.js`. Keep all three in sync. `build.cjs` also creates `console-controls.js` from `controls-core.js`, `ucb-click-flow.js`, and `src/control-agent.js`. The viewer is static HTML/CSS/JavaScript; it imports the same Firebase SDK version already used by the original viewer.

The tests cover synthetic GWT decoding, all-column whitelisting, malformed/changed schemas, duplicates, empty reports, request pagination, AES-GCM round trips and tampering, paired-row extraction, isolated credentials, metadata-only heartbeats and stopped/failed senders. Offline Chromium checks additionally exercised narrow mobile layouts, selection preservation, search/filter/settings and mocked receipt/stale-feed behavior. The supplied HTML's six records matched all twelve fields of the corresponding captured HAR records; the HAR contained seven records at its capture time.

Live UCB connectivity, deployed Firebase permissions and physical iOS Safari behavior still require a test in the actual environment. The app does not claim a hard real-time delivery guarantee.

For a **synthetic, offline design preview only**, open `?demo=1`. This never initializes Firebase or displays actual report records.
