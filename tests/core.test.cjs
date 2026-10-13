'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../ucb-core.js');
const row = (id = '1001') => Object.fromEntries(C.KEYS.map(k => [k, ({ callId: id,
  status: 'Inwork', certifier: 'SAMPLE CERTIFIER', aircraft: 'DEMO-01', workOrder: '00001001',
  remarks: 'EXAMPLE ONLY.\nUnicode: café & <img src=x onerror=alert(1)>', responses: 'Responses' })[k] || '']));
// A synthetic, minimal GWT object graph. No captured records or identity information.
function reportFixture({ total = 1, facility = 'JAX' } = {}) {
  const types = {
    dto: ['mil.navy.ndms.ucb.gwt.common.shared.dto.support.GenericUcbDto/1398413682', 'a:o b:o c:o d:o e:o f:o g:s i:o j:o k:o'],
    report: ['mil.navy.ndms.ucb.gwt.common.shared.report.ReportData/35051220', 'a:o b:o c:o d:i e:i f:s g:i i:i j:o k:o n:o'],
    row: ['mil.navy.ndms.ucb.gwt.common.shared.report.ReportHistoryDataRow/3774991779', 'a:b b:o c:o d:b e:o f:b g:o i:s j:s k:s n:o o:s'],
    source: ['mil.navy.ndms.ucb.gwt.common.shared.domain.CallSourceWithResponse/2218945681', 'a:o b:o __hash:s c:s d:s e:o f:o g:s i:s j:s k:s n:o o:o p:s q:o r:s s:s'],
    request: ['mil.navy.ndms.ucb.gwt.common.shared.domain.CallRequest/2964178198', '__hash:s a:s b:s c:s d:s e:o f:o g:o i:o j:s k:s n:o o:s p:o q:s r:o s:o t:s u:o v:s w:s A:s B:s C:o D:s F:s G:o H:s I:o J:s K:s L:s M:s N:s O:s P:s Q:s R:s'],
    context: ['mil.navy.ndms.ucb.gwt.common.shared.report.ReportExecutionContext/1449797842', 'a:i b:s c:s d:s e:o f:i g:o i:o j:i k:o']
  };
  const obj = (type, fields) => ({ type, ...fields });
  const graph = obj('dto', { a: obj('report', { i: total,
    j: obj('context', { a: 1, b: facility, d: 'TRAINERS', f: 1 }),
    c: total ? [obj('row', { a: 1, i: 'SAMPLE EXAMINER', c: obj('source', {
      e: 1001, g: 'EE', i: 'SAMPLE CERTIFIER', p: facility, s: 'TRAINERS',
      f: obj('request', { a: 'DEMO-01', R: '00001001', P: 'METALS', F: 'ZZ', b: 'EXAMPLE ONLY.' })
    }) })] : []
  }) });
  const strings = [], stream = [];
  function str(s) { if (!s) return 0; let i = strings.indexOf(s); if (i < 0) i = strings.push(s) - 1; return i + 1; }
  function write(value) {
    if (value == null) { stream.push(0); return; }
    if (Array.isArray(value)) { stream.push(str('java.util.ArrayList/4159755760'), value.length); value.forEach(write); return; }
    if (typeof value === 'number') { stream.push(str('java.lang.Integer/3438268394'), value); return; }
    const [signature, fields] = types[value.type]; stream.push(str(signature));
    for (const field of fields.split(' ')) {
      const [k, t] = field.split(':');
      if (t === 'o') write(value[k]); else stream.push(t === 's' ? str(value[k]) : value[k] || 0);
    }
  }
  write(graph); return '//OK' + JSON.stringify([...stream.reverse(), strings, 0, 7]);
}
test('whitelists exactly the report columns and strips extra credentials', () => {
  const s = C.snapshot([{ ...row(), securityToken: 'not-sent' }], 'rpc');
  assert.deepEqual(Object.keys(s.rows[0]), C.KEYS);
  assert.equal(JSON.stringify(s).includes('not-sent'), false);
  assert.equal(s.scope, 'all-pages');
});
test('rejects duplicate, missing, excessively long and unexpected fields/context', () => {
  assert.throws(() => C.snapshot([row(), row()], 'rpc'), /duplicate/);
  assert.throws(() => C.snapshot([{ ...row(), callId: '' }], 'rpc'));
  assert.throws(() => C.snapshot([{ ...row(), remarks: 'x'.repeat(20001) }], 'rpc'));
  assert.throws(() => C.snapshot([{ ...row(), trade: null }], 'rpc'));
  assert.throws(() => C.validateSnapshot({ ...C.snapshot([row()], 'rpc'), facility: 'OTHER' }));
});
test('decodes a synthetic E&E wire response into report fields', () => {
  const result = C.parseReport(reportFixture());
  assert.equal(result.total, 1); assert.equal(result.rows[0].callId, '1001');
  assert.equal(result.rows[0].status, 'Inwork'); assert.equal(result.rows[0].aircraft, 'DEMO-01');
  assert.equal(result.rows[0].remarks, 'EXAMPLE ONLY.'); assert.equal(result.rows[0].examiner, 'SAMPLE EXAMINER');
});
test('handles a genuinely empty report and rejects another facility', () => {
  assert.deepEqual(C.parseReport(reportFixture({ total: 0 })), { rows: [], total: 0 });
  assert.throws(() => C.parseReport(reportFixture({ facility: 'OTHER' })), /context/);
});
test('fails closed on exceptions, executable text and changed wire signatures', () => {
  for (const value of ['//EX[]', '//OKalert(1)', '//OK[1,[],0,8]', '//OK[1,["unknown.Type/1"],0,7]'])
    assert.throws(() => C.decodeGwt(value));
  assert.throws(() => C.parseReport(reportFixture().replace('ReportData/35051220', 'ReportData/CHANGED')));
});
test('builds bounded same-origin paginated read requests', () => {
  const request = C.reportBody('https://example.test', 50, 50);
  assert.ok(request.includes('|executeReport|'));
  assert.ok(request.endsWith('|50|50|6|1|7|0|8|9|0|1|0|0|0|9|0|'));
  assert.throws(() => C.reportBody('http://example.test'));
  assert.throws(() => C.reportBody('https://example.test/path'));
  assert.throws(() => C.reportBody('https://example.test', -1));
  assert.throws(() => C.reportBody('https://example.test', 0, 101));
});
test('pairing codes validate and can be extracted from private links', () => {
  const code = C.makeCode(); assert.equal(code.length, 43);
  assert.equal(C.pairingCode('https://example.test/#key=' + code), code);
  assert.throws(() => C.pairingCode('short')); assert.throws(() => C.pairingCode('!'.repeat(43)));
});
test('AES-GCM round trip preserves remarks and hides report text', async () => {
  const key = await C.importKey(C.makeCode()), s = C.snapshot([row()], 'rpc');
  const encrypted = await C.encrypt(s, key, 'v1');
  assert.equal(encrypted.includes('SAMPLE'), false);
  assert.deepEqual(await C.decrypt(encrypted, key, 'v1'), s);
  assert.notEqual(encrypted, await C.encrypt(s, key, 'v1'));
});
test('wrong key, version binding and ciphertext tampering reject', async () => {
  const key = await C.importKey(C.makeCode()), encrypted = await C.encrypt(C.snapshot([row()], 'rpc'), key, 'v1');
  await assert.rejects(C.decrypt(encrypted, await C.importKey(C.makeCode()), 'v1'));
  await assert.rejects(C.decrypt(encrypted, key, 'v2'));
  const altered = JSON.parse(encrypted); altered.data = (altered.data[0] === 'A' ? 'B' : 'A') + altered.data.slice(1);
  await assert.rejects(C.decrypt(JSON.stringify(altered), key, 'v1'));
});
test('DOM parsing joins separate physical rows without altering remarks', () => {
  const cells = C.KEYS.map((key, i) => ({ textContent: row()[key], getAttribute: () => String(i) }));
  const trs = [cells.slice(0, 10), cells.slice(10)].map(group => ({ getAttribute: () => '0', querySelectorAll: () => group }));
  const tbody = { querySelectorAll: () => trs };
  const container = { querySelectorAll: sel => sel.includes('tbody') ? [tbody] : sel === '.gwt-HTML' ? [{ textContent: '1-1 of 1' }] : [] };
  const doc = { querySelectorAll: () => [{ textContent: C.TITLE }], getElementById: id => id === 'responseTableContainer' ? container :
    { textContent: id.endsWith('facility') ? 'JAX' : 'TRAINERS' } };
  const parsed = C.parseDOM(doc); assert.equal(parsed.rows[0].remarks, row().remarks); assert.equal(parsed.scope, 'visible-page');
  cells.pop(); // Recreate a clearly incomplete redraw instead of accepting partial data.
  trs[1].querySelectorAll = () => [];
  assert.throws(() => C.parseDOM(doc), /incomplete/);
});
test('bundled console sender parses as one standalone script', () => {
  new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'console-sender.js'), 'utf8'));
});
