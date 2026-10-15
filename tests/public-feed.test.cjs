'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../ucb-core.js');
const P = require('../public-feed.js');
const row = Object.fromEntries(C.KEYS.map(k => [k, ({
  callId:'4001', status:'Accept',certifier:'SAMPLE CERTIFIER',
  aircraft:'DEMO-01',workOrder:'00112233',trade:'METALS',remarks:'SYNTHETIC REMARKS'
})[k] || '']));
test('public feed preserves the twelve fields and validates boundaries', () => {
  const snapshot = C.snapshot([row],'rpc');
  assert.deepEqual(P.decode(P.encode(snapshot)), snapshot);
  assert.match(P.encode(snapshot), /SYNTHETIC REMARKS/);
  assert.throws(() => P.decode('not JSON'));
  assert.throws(() => P.decode(JSON.stringify({...snapshot,facility:'WRONG'})));
  assert.throws(() => P.decode('x'.repeat(450001)));
});
test('freshness expires after thirty seconds and rejects future timestamps', () => {
  const now = 1_000_000;
  assert.equal(P.VERSION, 'ucb-public-v1');
  assert.equal(P.MAX_AGE_MS,30000);
  assert.equal(P.fresh(now-30000,now),true);
  assert.equal(P.fresh(now-30001,now),false);
  assert.equal(P.fresh(now+5001,now),false);
  assert.equal(P.fresh(NaN,now),false);
});
