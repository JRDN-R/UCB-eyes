# UCB Eyes · Text edition

A mobile-first, strictly read-only E&E Outstanding report viewer with compact, selectable cards, two-second source polling, and a quiet last-received time. The original screenshot viewer remains at `screen.html`. The deprecated remote Accept feature and its optional control scripts have been removed; this application never changes UCB calls.

## Start the feed

**If you previously installed the old remote Accept add-on:** In the *existing*
UCB DevTools Console, run `window.__UCB_EYES_CONTROLS__?.stop()` to terminate
that in-memory add-on. The read-only sender can keep running independently.
The current website no longer includes any controls code, Accept buttons, or
remote command endpoints. Updating GitHub cannot stop an already-running script
in another browser, so this one-time cleanup matters.


1. Stop the old screen-capture publisher. On the source computer, open **JAX → TRAINERS → E&E → Outstanding** in the existing, authenticated UCB session.
2. Open DevTools → **Console**, choose **top**, and paste the complete contents of **[console-sender.js](console-sender.js)**. The viewer's Settings → **Copy console script** copies the same standalone script. No extension, local server, remote code loader or installation is required for the sender.
3. Read the destination confirmation. Enter an existing pairing code, or leave the prompt blank to generate one. Open the **private iPhone viewer link** printed in the console on your approved mobile device. Alternatively, open the viewer and paste the pairing code into Settings.

The unpaired public page contains no live report text. The private link contains the decryption key; treat it as a secret and share it only with approved recipients. The viewer removes the key from the address bar after reading it and keeps it in tab-scoped session storage, not persistent local storage. A new tab or expired browser session may require pairing again. Keep the code privately to reuse the same pairing on another day. **Forget this device** clears the active viewer and its saved tab key; it does not revoke other devices. Generate a new sender code to rotate access to future updates.

Console controls:

```js
__UCB_EYES__.status()
__UCB_EYES__.sendNow()
__UCB_EYES__.stop()
```

The source tab must remain open, signed in and running on an awake computer. A console script is removed by a full page navigation or reload; paste it again afterward. Browser sleep, background throttling, network delay, server load and retries can make delivery slower than two seconds. Safari reconnects on return to the page. The displayed time advances only after a complete, server-confirmed incoming text update, not with the local clock or a repeated cache read.

## What changed

- Native portrait-friendly cards, light/dark appearance, iOS safe-area spacing, readable wrapping and ordinary text selection. No forced landscape, screenshot-only text or zoom restrictions.
- Compact cards show aircraft, work order, trade, a short remarks preview and the certifier / E&E names. Tap **More · full remarks** to expand the entire selectable remarks and additional metadata. Work orders retain their copy button.
- Cards assigned to **JORDAN RAPP** in the E&E field have a deep-teal background with high-contrast selectable text, regardless of the report status. Remarks and certifier names cannot trigger this highlight.
- Search across all twelve report fields; All / Accept / Inwork filters. **Any populated E&E name overrides an Accept label** for display, counts and filtering without modifying the UCB record. These are read-only status labels, not UCB action buttons.
- The Trade menu defaults to **Metals + Paint first** with the original relative order retained. Choose **Metals + Paint only** to hide other trades or **All trades · original order** to restore the report order. Trade and status filters work together.
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

`console-sender.js` is generated from `ucb-core.js` and `src/sender.js`. Keep all three in sync. `view-model.js` holds testable display-only status, assignment and trade rules. The viewer is static HTML/CSS/JavaScript; it imports the same Firebase SDK version already used by the original viewer.

The tests cover compact status, personal highlight and trade sorting, synthetic GWT decoding, all-column whitelisting, malformed/changed schemas, duplicates, empty reports, request pagination, AES-GCM round trips and tampering, paired-row extraction, isolated credentials, metadata-only heartbeats and stopped/failed senders. Offline Chromium checks additionally exercised narrow mobile layouts, selection preservation, search/filter/settings and mocked receipt/stale-feed behavior. The supplied HTML's six records matched all twelve fields of the corresponding captured HAR records; the HAR contained seven records at its capture time.

Live UCB connectivity, deployed Firebase permissions and physical iOS Safari behavior still require a test in the actual environment. The app does not claim a hard real-time delivery guarantee.

For a **synthetic, offline design preview only**, open `?demo=1`. This never initializes Firebase or displays actual report records.
