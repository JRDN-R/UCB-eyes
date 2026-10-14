/* Stable keyed DOM rendering: heartbeats never replace selectable text nodes. */
(function () {
  'use strict';
  const C = globalThis.UcbEyesCore;
  const V = globalThis.UcbEyesViewModel;
  const $ = id => document.getElementById(id);
  let toastTimer;
  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
  }
  class Board {
    constructor() {
      this.cards = $('cards'); this.nodes = new Map(); this.rows = []; this.pending = null;
      this.filter = 'all'; this.tradeView = 'priority'; this.hasData = false;
      $('search').addEventListener('input', () => this.applyFilters());
      document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
        this.filter = button.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        this.applyFilters();
      }));
      $('tradeView').addEventListener('change', () => {
        this.tradeView = $('tradeView').value;
        this.applyFilters();
      });
      document.addEventListener('selectionchange', () => {
        if (this.pending && !this.selecting()) {
          const pending = this.pending; this.pending = null; this.set(pending);
        }
      });
      $('applyUpdate').addEventListener('click', () => {
        window.getSelection()?.removeAllRanges();
        if (this.pending) { const pending = this.pending; this.pending = null; this.set(pending); }
      });
    }
    selecting() {
      const selection = window.getSelection();
      return Boolean(selection && !selection.isCollapsed &&
        (this.cards.contains(selection.anchorNode) || this.cards.contains(selection.focusNode)));
    }
    clear() {
      this.cards.replaceChildren(); this.nodes.clear(); this.rows = []; this.pending = null;
      this.hasData = false; $('pendingNotice').hidden = true; this.applyFilters();
    }
    set(value) {
      const snapshot = C.validateSnapshot(value);
      if (this.selecting() && JSON.stringify(this.rows) !== JSON.stringify(snapshot.rows)) {
        this.pending = snapshot; $('pendingNotice').hidden = false; return;
      }
      this.pending = null; $('pendingNotice').hidden = true; this.hasData = true;
      const wanted = new Set(snapshot.rows.map(r => r.callId));
      for (const [id, node] of this.nodes) if (!wanted.has(id)) { node.remove(); this.nodes.delete(id); }
      for (const row of snapshot.rows) {
        let node = this.nodes.get(row.callId);
        if (!node) {
          node = $('cardTemplate').content.firstElementChild.cloneNode(true);
          node.dataset.callId = row.callId;
          node.querySelector('.copy-order').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(node.__row.workOrder); toast('Work order copied.'); }
            catch { toast('Press and hold the work order to select and copy it.'); }
          });
          const details = node.querySelector('.call-details');
          details.addEventListener('toggle', () => node.classList.toggle('expanded', details.open));
          this.nodes.set(row.callId, node);
        }
        node.__row = row;
        node.classList.toggle('mine', V.isMine(row));
        for (const field of node.querySelectorAll('[data-field]')) {
          const key = field.dataset.field;
          const value = key === 'status' ? (V.status(row) === 'inwork' ? 'Inwork' : 'Accept') :
            row[key] || (key === 'examiner' ? 'Unassigned' : key === 'remarks' ? 'No remarks.' : '—');
          if (field.textContent !== value) field.textContent = value;
          if (key === 'trade') field.title = row.trade;
        }
        node.querySelector('.badge').className = 'badge' + (V.status(row) === 'accept' ? ' accept' : '');
        node.querySelector('.copy-order').setAttribute('aria-label', 'Copy work order ' + row.workOrder);
        node.querySelector('.copy-order').disabled = !row.workOrder;
      }
      this.rows = snapshot.rows;
      this.applyFilters();
    }
    applyFilters() {
      const query = C.flat($('search').value).toLowerCase();
      let shown = 0, accepts = 0, inwork = 0;
      const orderedRows = V.ordered(this.rows, this.tradeView);
      // Move existing DOM elements only when their order really changes.
      for (let index = 0; index < orderedRows.length; index++) {
        const node = this.nodes.get(orderedRows[index].callId);
        if (this.cards.children[index] !== node)
          this.cards.insertBefore(node, this.cards.children[index] || null);
      }
      for (const row of this.rows) {
        const currentStatus = V.status(row);
        if (currentStatus === 'accept') accepts++;
        if (currentStatus === 'inwork') inwork++;
        const visible = (this.filter === 'all' || currentStatus === this.filter) &&
          (this.tradeView !== 'only' || V.isMetalsPaint(row)) &&
          (!query || C.KEYS.some(key => row[key].toLowerCase().includes(query)));
        this.nodes.get(row.callId).hidden = !visible;
        if (visible) shown++;
      }
      const update = (id, value) => { if ($(id).textContent !== String(value)) $(id).textContent = value; };
      update('countAll', this.rows.length); update('countAccept', accepts); update('countInwork', inwork);
      update('resultCount', this.hasData ? `${shown} request${shown === 1 ? '' : 's'}` : '');
      $('empty').hidden = this.hasData && shown > 0;
      $('pairButton').hidden = this.hasData;
      if (this.hasData) {
        update('emptyTitle', this.rows.length ? 'No matching requests.' : 'All clear.');
        update('emptyText', this.rows.length ? 'Try another search, status, or trade selection.' : 'UCB reports no outstanding E&E requests.');
      } else {
        update('emptyTitle', 'Your call board, readable.');
        update('emptyText', 'Connect the UCB console sender to see live requests here. Text stays selectable, including work orders and remarks.');
      }
    }
  }
  globalThis.UcbEyesBoard = Board;
  globalThis.ucbToast = toast;
})();
