/* UCB Eyes: pure parsing, validation and encrypted transport. No network calls. */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.UcbEyesCore = core;
})(globalThis, function () {
  'use strict';
  const VERSION = 'ucb-text-v1';
  const TITLE = 'E&E Outstanding Report';
  const KEYS = ['status', 'callId', 'certifier', 'aircraft', 'workOrder', 'trade',
    'requestDate', 'planner', 'examiner', 'inWorkDate', 'responses', 'remarks'];
  const MAX_ROWS = 1000;
  const text = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  const flat = value => text(value).replace(/\s+/g, ' ');
  function validateSnapshot(value) {
    if (!value || value.schema !== VERSION || value.title !== TITLE ||
        value.facility !== 'JAX' || value.program !== 'TRAINERS' ||
        !['rpc', 'dom'].includes(value.mode) || !Array.isArray(value.rows) || value.rows.length > MAX_ROWS)
      throw new Error('Not a supported JAX / TRAINERS E&E report.');
    const ids = new Set();
    const rows = value.rows.map(row => {
      if (!row || typeof row !== 'object') throw new Error('Invalid report row.');
      const result = {};
      for (const k of KEYS) {
        if (typeof row[k] !== 'string' || row[k].length > (k === 'remarks' ? 20000 : 500))
          throw new Error('Invalid report field: ' + k);
        result[k] = row[k];
      }
      if (!/^\d{1,12}$/.test(result.callId) || ids.has(result.callId))
        throw new Error('Missing or duplicate Call ID.');
      ids.add(result.callId);
      return result;
    });
    return { schema: VERSION, title: TITLE, facility: 'JAX', program: 'TRAINERS',
      mode: value.mode, scope: value.mode === 'rpc' ? 'all-pages' : 'visible-page',
      pagination: flat(value.pagination || '').slice(0, 100), rows };
  }
  function snapshot(rows, mode, pagination = '') {
    return validateSnapshot({ schema: VERSION, title: TITLE, facility: 'JAX', program: 'TRAINERS', mode, pagination, rows });
  }
  function reportContext(doc) {
    const title = [...doc.querySelectorAll('.ucb-report-table thead th')]
      .some(el => flat(el.textContent) === TITLE);
    return title && flat(doc.getElementById('call-request-display-facility')?.textContent) === 'JAX' &&
      flat(doc.getElementById('call-request-display-program')?.textContent) === 'TRAINERS';
  }
  function parseDOM(doc) {
    if (!reportContext(doc)) throw new Error('Open JAX / TRAINERS / E&E / Outstanding in UCB first.');
    const container = doc.getElementById('responseTableContainer') || doc;
    const rows = [];
    for (const tbody of container.querySelectorAll('.ucb-report-table > tbody')) {
      const groups = new Map();
      for (const tr of tbody.querySelectorAll(':scope > tr[cst_row_index]')) {
        const index = tr.getAttribute('cst_row_index');
        if (!groups.has(index)) groups.set(index, new Map());
        for (const td of tr.querySelectorAll(':scope > td[customindex]')) {
          const col = Number(td.getAttribute('customindex'));
          // Preserve line breaks and spelling in remarks; remove layout whitespace elsewhere.
          const raw = td.textContent || '';
          groups.get(index).set(col, col === 11 ? text(raw) : flat(raw));
        }
      }
      for (const cells of groups.values()) {
        if (![...Array(12).keys()].every(i => cells.has(i)))
          throw new Error('The report is being redrawn; an incomplete row was ignored.');
        rows.push(Object.fromEntries(KEYS.map((key, i) => [key, cells.get(i)])));
      }
    }
    const pagination = [...container.querySelectorAll('.gwt-HTML')].map(e => flat(e.textContent))
      .find(s => /^\d+\s*[-–]\s*\d+\s+of\s+\d+$/i.test(s)) || '';
    if (!rows.length && !/^0\s*[-–]\s*0\s+of\s+0$/i.test(pagination) &&
        ![...container.querySelectorAll('.ndms-NoDataPanel')].some(e => /no (data|records|requests)/i.test(e.textContent)))
      throw new Error('No complete rows or explicit empty-report marker yet.');
    return snapshot(rows, 'dom', pagination);
  }

  // Wire schemas verified against the supplied GWT 2.8 report response and serializers.
  // Exact type signatures fail closed after incompatible UCB releases. These aliases
  // are internal wire fields, NOT the object sent to Firebase.
  const schemas = {
    "mil.navy.ndms.ucb.gwt.common.shared.dto.support.GenericUcbDto/1398413682": "a:o b:o c:o d:o e:o f:o g:s i:o j:o k:o",
    "mil.navy.ndms.ucb.gwt.common.shared.report.ReportData/35051220": "a:o b:o c:o d:i e:i f:s g:i i:i j:o k:o n:o",
    "mil.navy.ndms.ucb.gwt.common.shared.report.ReportHistoryDataRow/3774991779": "a:b b:o c:o d:b e:o f:b g:o i:s j:s k:s n:o o:s",
    "mil.navy.ndms.ucb.gwt.common.shared.domain.CallSourceWithResponse/2218945681": "a:o b:o __hash:s c:s d:s e:o f:o g:s i:s j:s k:s n:o o:o p:s q:o r:s s:s",
    "mil.navy.ndms.ucb.gwt.common.shared.domain.CallRequest/2964178198": "__hash:s a:s b:s c:s d:s e:o f:o g:o i:o j:s k:s n:o o:s p:o q:s r:o s:o t:s u:o v:s w:s A:s B:s C:o D:s F:s G:o H:s I:o J:s K:s L:s M:s N:s O:s P:s Q:s R:s",
    "mil.navy.ndms.ucb.gwt.common.shared.domain.CallResponse/198420672": "__hash:s a:o b:o c:o d:s e:s f:s g:s i:s j:s k:s n:o o:o p:s q:s",
    "mil.navy.ndms.ucb.gwt.common.shared.report.ReportExecutionContext/1449797842": "a:i b:s c:s d:s e:o f:i g:o i:o j:i k:o",
    "mil.navy.ndms.ucb.gwt.common.shared.report.ReportSortElement/3491951016": "a:i b:o c:o",
    "mil.navy.ndms.ucb.gwt.common.shared.report.ReportParameter/3872375245": "a:s b:o c:s d:b e:b f:b g:b i:s j:b k:o n:b",
  };
  const scalars = new Set(['java.lang.Integer/3438268394', 'java.lang.Boolean/476441737',
    'java.lang.Double/858496421', 'java.lang.Float/1718559123',
    'mil.navy.ndms.ucb.gwt.common.shared.report.DatabaseObjectName/2235062944',
    'mil.navy.ndms.ucb.gwt.common.shared.report.SqlParameterTypes/343522771',
    'mil.navy.ndms.gwt.integri.common.shared.constants.SortConstants/1229288516']);
  const lists = new Set(['java.util.ArrayList/4159755760', 'java.util.LinkedList/3953877921',
    'java.util.Arrays$ArrayList/2507071751']);
  function decodeGwt(response) {
    if (typeof response !== 'string' || response.length > 3000000 || !response.startsWith('//OK'))
      throw new Error('UCB did not return a successful report. Reopen the report and check your session.');
    let wire;
    try { wire = JSON.parse(response.slice(4)); } catch {
      throw new Error('Unsupported UCB response format. No response code was executed.');
    }
    if (!Array.isArray(wire) || wire.pop() !== 7 || wire.pop() !== 0)
      throw new Error('Unsupported GWT protocol.');
    const strings = wire.pop();
    if (!Array.isArray(strings) || !strings.every(s => typeof s === 'string') || wire.length > 200000)
      throw new Error('Invalid GWT string table.');
    const refs = [];
    function take() { if (!wire.length) throw new Error('Incomplete GWT response.'); return wire.pop(); }
    function integer() { const v = take(); if (!Number.isSafeInteger(v)) throw new Error('Invalid GWT integer.'); return v; }
    function string(index = integer()) {
      if (index === 0) return '';
      if (index < 1 || index > strings.length) throw new Error('Invalid GWT string reference.');
      return strings[index - 1];
    }
    function long() {
      const v = take();
      if (typeof v !== 'string' || !/^[A-Za-z0-9$_]{1,11}$/.test(v)) throw new Error('Invalid GWT date.');
      let n = 0n;
      for (const c of v) n = (n << 6n) | BigInt('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_'.indexOf(c));
      const result = Number(BigInt.asIntN(64, n));
      if (!Number.isSafeInteger(result)) throw new Error('GWT date exceeds safe precision.');
      return result;
    }
    function object(depth = 0) {
      if (depth > 100 || refs.length > 30000) throw new Error('GWT object limit exceeded.');
      const id = integer();
      if (id === 0) return null;
      if (id < 0) {
        if (-id > refs.length) throw new Error('Invalid GWT object reference.');
        return refs[-id - 1];
      }
      const type = string(id), slot = refs.length;
      let result = { _type: type };
      refs.push(result);
      if (Object.prototype.hasOwnProperty.call(schemas, type)) {
        for (const field of schemas[type].split(' ')) {
          const [key, kind] = field.split(':');
          result[key] = kind === 'o' ? object(depth + 1) : kind === 's' ? string() : integer();
        }
      } else if (lists.has(type) || type === 'java.util.Collections$EmptyList/4157118744' ||
                 type === 'java.util.Collections$SingletonList/1586180994') {
        const length = lists.has(type) ? integer() : type.includes('EmptyList') ? 0 : 1;
        if (length < 0 || length > 5000) throw new Error('Invalid GWT list length.');
        result = []; refs[slot] = result;
        for (let i = 0; i < length; i++) result.push(object(depth + 1));
      } else if (scalars.has(type)) result = integer();
      else if (type === 'java.lang.String/2004016611') result = string();
      else if (['java.sql.Timestamp/3040052672', 'java.util.Date/3385151746', 'java.sql.Date/730999118'].includes(type)) {
        result = { ms: long() };
        if (type.startsWith('java.sql.Timestamp/')) result.nanos = integer();
      } else throw new Error('UCB wire schema changed: ' + type.split('/')[0].split('.').pop());
      refs[slot] = result;
      return result;
    }
    const result = object();
    if (wire.length) throw new Error('Unconsumed GWT data; refusing an incomplete interpretation.');
    return result;
  }
  const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
  function formatDate(date) {
    if (date == null) return '';
    if (!Number.isSafeInteger(date.ms)) throw new Error('Invalid report timestamp.');
    const p = Object.fromEntries(dateFormat.formatToParts(date.ms).map(v => [v.type, v.value]));
    return `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute} ${p.dayPeriod}`;
  }
  function parseReport(response) {
    const dto = decodeGwt(response), report = dto?.a;
    if (!report?._type?.endsWith('ReportData/35051220') ||
        report.j?.a !== 1 || report.j?.b !== 'JAX' || report.j?.d !== 'TRAINERS' || report.j?.f !== 1)
      throw new Error('UCB returned a different report context.');
    const records = report.c ?? [];
    if (!Array.isArray(records) || !Number.isSafeInteger(report.i) || report.i < 0 || report.i > MAX_ROWS)
      throw new Error('Invalid report row count.');
    const rows = records.map(row => {
      const source = row.c, request = source?.f;
      if (!row._type?.endsWith('ReportHistoryDataRow/3774991779') || !request || source.g !== 'EE' ||
          source.p !== 'JAX' || source.s !== 'TRAINERS' || ![0, 1].includes(row.a))
        throw new Error('Unexpected report row type or context.');
      // Only the twelve report columns leave this function. No raw DTO, personnel
      // identity strings, credentials, response internals or source page HTML.
      return {
        status: row.a ? 'Inwork' : 'Accept', callId: String(source.e), certifier: text(source.i),
        aircraft: text(request.a), workOrder: text(request.R), trade: text(request.P),
        requestDate: formatDate(source.o), planner: text(request.F), examiner: text(row.i),
        inWorkDate: formatDate(row.g), responses: 'Responses', remarks: text(request.b)
      };
    });
    return { rows: snapshot(rows, 'rpc').rows, total: report.i };
  }
  function reportBody(origin, offset = 0, limit = 50) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('A same-origin HTTPS UCB page is required.');
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Invalid report page.');
    return `7|0|9|${origin}/Ucb/ucb_call_response/|BC3D0C4D0746C31A3747BD221F73967A|` +
      'mil.navy.ndms.ucb.gwt.common.shared.service.UcbReportService|executeReport|I|' +
      'mil.navy.ndms.ucb.gwt.common.shared.report.ReportExecutionContext/1449797842|JAX|TRAINERS|' +
      `java.util.ArrayList/4159755760|1|2|3|4|3|5|5|6|${offset}|${limit}|6|1|7|0|8|9|0|1|0|0|0|9|0|`;
  }
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64(str) {
    if (typeof str !== 'string' || !/^[A-Za-z0-9_-]+$/.test(str)) throw new Error('Invalid encoded data.');
    return Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - str.length % 4) % 4)), c => c.charCodeAt(0));
  }
  function pairingCode(input) {
    let code = text(input);
    if (code.startsWith('https://')) {
      const url = new URL(code);
      code = new URLSearchParams(url.hash.slice(1)).get('key') || '';
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || unb64(code).length !== 32 || b64(unb64(code)) !== code)
      throw new Error('Paste the 43-character pairing code or private viewer link from the sender.');
    return code;
  }
  const makeCode = () => b64(crypto.getRandomValues(new Uint8Array(32)));
  const importKey = code => crypto.subtle.importKey('raw', unb64(pairingCode(code)), 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function encrypt(value, key, version) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(validateSnapshot(value)));
    if (plain.length > 450000) throw new Error('The report exceeds the single-chunk safety limit.');
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(version) }, key, plain);
    return JSON.stringify({ format: VERSION, iv: b64(iv), data: b64(new Uint8Array(data)) });
  }
  async function decrypt(envelope, key, version) {
    if (typeof envelope !== 'string' || envelope.length > 650000) throw new Error('Invalid encrypted snapshot.');
    const e = JSON.parse(envelope);
    if (e.format !== VERSION || typeof e.iv !== 'string' || unb64(e.iv).length !== 12 || typeof e.data !== 'string')
      throw new Error('Invalid encrypted snapshot format.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv),
      additionalData: new TextEncoder().encode(version) }, key, unb64(e.data));
    return validateSnapshot(JSON.parse(new TextDecoder().decode(plain)));
  }
  return { VERSION, TITLE, KEYS, MAX_ROWS, text, flat, snapshot, validateSnapshot, reportContext, parseDOM,
    decodeGwt, parseReport, reportBody, pairingCode, makeCode, importKey, encrypt, decrypt };
});
