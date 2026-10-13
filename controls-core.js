/* Authenticated control messages use a DIFFERENT random key from the viewing key. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UcbControlCore = api;
})(globalThis, function() {
  'use strict';
  const FORMAT = 'ucb-control-v1';
  const TTL = 30000;
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
  function encode(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function decode(text) {
    if (typeof text !== 'string' || !/^[\w-]+$/.test(text)) throw new Error('Invalid control data.');
    return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4-text.length%4)%4)), c=>c.charCodeAt(0));
  }
  function code(text) {
    text = String(text || '').trim();
    if (!/^[\w-]{43}$/.test(text) || decode(text).length !== 32 || encode(decode(text)) !== text)
      throw new Error('Paste the 43-character CONTROL code from UCB Eyes settings, not the viewing code.');
    return text;
  }
  const generateCode = () => encode(crypto.getRandomValues(new Uint8Array(32)));
  const importKey = text => crypto.subtle.importKey('raw', decode(code(text)), 'AES-GCM', false, ['encrypt','decrypt']);
  const digest = async text => encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const keyId = text => digest('ucb-control-key|' + code(text));
  const rowFingerprint = row => digest(JSON.stringify(['status','callId','certifier','aircraft','workOrder','trade',
    'requestDate','planner','examiner','inWorkDate','responses','remarks'].map(k => row[k])));
  function context(kind, session) {
    if (!['info','command','result'].includes(kind) || (kind !== 'info' && !uuid(session))) throw new Error('Invalid control context.');
    return new TextEncoder().encode(FORMAT + '|' + kind + '|' + (session || 'current'));
  }
  async function seal(value, key, kind, session) {
    const plain = new TextEncoder().encode(JSON.stringify(value));
    if (plain.length > 20000) throw new Error('Control message is too large.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context(kind,session)}, key, plain);
    return JSON.stringify({format:FORMAT,iv:encode(iv),data:encode(encrypted)});
  }
  async function open(text, key, kind, session) {
    if (typeof text !== 'string' || text.length > 30000) throw new Error('Invalid control envelope.');
    const e=JSON.parse(text);
    if (e.format!==FORMAT || decode(e.iv).length!==12) throw new Error('Invalid control envelope.');
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(e.iv),additionalData:context(kind,session)},key,decode(e.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function validateCommand(value, session, now = Date.now()) {
    if (!value || Object.keys(value).sort().join(',') !== 'aircraft,callId,expiresAt,fingerprint,id,issuedAt,session,type,workOrder' ||
        value.type !== 'accept' || value.session !== session || !uuid(session) || !uuid(value.id) ||
        !/^\d{1,12}$/.test(value.callId) || typeof value.callId !== 'string' ||
        typeof value.workOrder !== 'string' || value.workOrder.length > 500 ||
        typeof value.aircraft !== 'string' || value.aircraft.length > 500 ||
        typeof value.fingerprint !== 'string' || !/^[\w-]{43}$/.test(value.fingerprint))
      throw new Error('Invalid or unsupported command. Only Accept is supported.');
    if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt - value.issuedAt !== TTL || value.issuedAt > now+5000 ||
        value.issuedAt < now-TTL || value.expiresAt <= now)
      throw new Error('This request expired or the device clock differs. Review the call and try again.');
    return value;
  }
  function validateInfo(v) {
    if (!v || v.format!==FORMAT || typeof v.enabled!=='boolean' || typeof v.ready!=='boolean' ||
        typeof v.busy!=='boolean' || typeof v.actor!=='string' || v.actor.length>200 ||
        typeof v.reason!=='string' || v.reason.length>500 || !Array.isArray(v.visibleCallIds) ||
        v.visibleCallIds.length>1000 || !v.visibleCallIds.every(id=>typeof id==='string' && /^\d{1,12}$/.test(id)))
      throw new Error('Invalid control status.');
    if (v.enabled && (!uuid(v.session) || typeof v.keyId!=='string' || !/^[\w-]{43}$/.test(v.keyId) ||
        !Number.isSafeInteger(v.expiresAt))) throw new Error('Invalid control authorization.');
    return v;
  }
  function validateResult(v, session) {
    if (!v || v.session!==session || !uuid(v.commandId) || typeof v.callId!=='string' || !/^\d{1,12}$/.test(v.callId) ||
        !['checking','accept','return','continue','verifying','succeeded','rejected','uncertain','cancelled'].includes(v.phase) ||
        typeof v.message!=='string' || v.message.length>1000) throw new Error('Invalid action result.');
    return v;
  }
  const terminal = phase => ['succeeded','rejected','uncertain','cancelled'].includes(phase);
  return {FORMAT,TTL,uuid,code,generateCode,importKey,keyId,rowFingerprint,seal,open,validateCommand,validateInfo,validateResult,terminal};
});
