/* Public, read-only feed transport. A private viewer key is intentionally not used. */
(function (root, factory) {
  const feed = factory(root.UcbEyesCore || (typeof require === 'function' ? require('./ucb-core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = feed;
  else root.UcbEyesPublic = feed;
})(globalThis, function (core) {
  'use strict';
  const VERSION = 'ucb-public-v1';
  const MAX_AGE_MS = 30000;
  const MAX_BYTES = 450000;
  function encode(value) {
    const data = JSON.stringify(core.validateSnapshot(value));
    if (new TextEncoder().encode(data).byteLength > MAX_BYTES)
      throw new Error('The report exceeds the allowed public snapshot size.');
    return data;
  }
  function decode(data) {
    if (typeof data !== 'string' || data.length > MAX_BYTES)
      throw new Error('Invalid public report snapshot.');
    return core.validateSnapshot(JSON.parse(data));
  }
  function fresh(stamp, now = Date.now()) {
    return Number.isFinite(stamp) && stamp > 0 && stamp <= now + 5000 && now - stamp <= MAX_AGE_MS;
  }
  return { VERSION, MAX_AGE_MS, encode, decode, fresh };
});
