'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../view-model.js');
const row = (callId, trade, status = 'Accept', examiner = '') => ({ callId, trade, status, examiner });

test('populated examiner means Inwork even if report action is Accept', () => {
  const assigned = row('3','METALS','Accept','A. EXAMINER');
  assert.equal(V.status(assigned),'inwork');
  assert.equal(assigned.status,'Accept', 'underlying report remains unchanged');
  assert.equal(V.status(row('4','RIGGING','Inwork','')), 'inwork');
});
test('empty or placeholder examiner does not override Accept', () => {
  for (const v of ['', '  ', 'N/A', 'NA', '—', '-', 'Unassigned', 'Not Assigned', 'pending'])
    assert.equal(V.status(row('2','METALS','Accept',v)),'accept',v);
  assert.equal(V.status(row('2','METALS','Accept','  JANE DOE  ')),'inwork');
});
test('only the E&E field triggers personal dark-teal highlighting', () => {
  for(const value of ['Jordan Rapp','  JORDAN    RAPP  ','Rapp, Jordan','Jordan D. Rapp','JORDAN D RAPP']) {
    assert.equal(V.isMine(row('2','METALS','Accept',value)),true,value);
  }
  for(const value of ['','Unassigned','JORDAN RAPPS','FRANK JORDAN RAPP','OTHER EXAMINER']) {
    assert.equal(V.isMine(row('3','METALS','Accept',value)),false,value);
  }
  assert.equal(V.isMine({...row('1','METALS','Accept',''),certifier:'Jordan Rapp',remarks:'Ask Jordan Rapp'}),false);
  assert.equal(V.status(row('2','METALS','Accept','Jordan Rapp')),'inwork');
});
test('trade priority keeps Metals and Paint together and retains source order within each group', () => {
  const rows=[row('1','RIGGING'),row('2','PAINT'),row('3','METALS'),row('4','ELECTRICAL'),row('5','PAINTING'),row('6','METALS')];
  assert.deepEqual(V.ordered(rows,'priority').map(x=>x.callId),['2','3','5','6','1','4']);
  assert.deepEqual(V.ordered(rows,'only').map(x=>x.callId),['2','3','5','6']);
  assert.deepEqual(V.ordered(rows,'all').map(x=>x.callId),['1','2','3','4','5','6']);
  assert.deepEqual(rows.map(x=>x.callId),['1','2','3','4','5','6']);
});
test('trade matching is case insensitive and does not match partial words', () => {
  assert.equal(V.isMetalsPaint(row('1','metals')),true);
  assert.equal(V.isMetalsPaint(row('2','Paint Shop')),true);
  assert.equal(V.isMetalsPaint(row('3','PAINTING')),true);
  assert.equal(V.isMetalsPaint(row('4','SHEET METAL')),true);
  assert.equal(V.isMetalsPaint(row('5','METALLURGY')),false);
  assert.equal(V.isMetalsPaint(row('6','PAINTLESS REPAIR')),false);
  assert.equal(V.isMetalsPaint(row('7','ELECTRICAL')),false);
});

test('viewer uses private link and contains no manual passcode input', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '..', 'viewer.js'), 'utf8');
  assert.equal(/id="pairCode"|id="pairForm"|type="password"/.test(html), false);
  for (const id of ['pairForm', 'pairCode', 'pairError'])
    assert.equal(viewer.includes("$('" + id + "')"), false);
  assert.ok(viewer.includes("fragment.get('key') || stored"));
  assert.ok(viewer.includes("sessionStorage.setItem('ucb-eyes-viewer-key-v1', code)"));
  assert.ok(viewer.includes("history.replaceState(null, '', location.pathname + location.search)"));
});
