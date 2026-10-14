/* Read-only presentation rules for UCB Eyes, shared by UI and unit tests. */
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.UcbEyesViewModel = model;
})(globalThis, function () {
  'use strict';
  const normalized = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  const unassigned = /^(?:-|—|–|n\/?a|none|null|unknown|unassigned|not assigned|pending)$/i;

  function hasExaminer(row) {
    const examiner = normalized(row?.examiner);
    return examiner !== '' && !unassigned.test(examiner);
  }
  function status(row) {
    // UCB sometimes reports Accept even when an E&E examiner is assigned.
    // Display-only correction; do not modify the source record.
    if (hasExaminer(row) || /^in\s*work$/i.test(normalized(row?.status))) return 'inwork';
    return 'accept';
  }
  function isMine(row) {
    // Inspect E&E assignee only; never names in remarks or certifier.
    // Support UCB's reversed-name format and an optional middle initial.
    const name = normalized(row?.examiner).toUpperCase();
    return /^(?:JORDAN(?: D\.?)? RAPP|RAPP, ?JORDAN(?: D\.?)?)$/.test(name);
  }
  function isMetalsPaint(row) {
    return /(?:^|[^a-z])(?:metals?|paint(?:ing|s)?)(?=$|[^a-z])/i.test(normalized(row?.trade));
  }
  function ordered(rows, tradeView = 'priority') {
    const list = Array.from(rows);
    if (tradeView === 'only') return list.filter(isMetalsPaint);
    if (tradeView === 'priority') {
      return list.map((row, index) => ({ row, index })).sort((a, b) =>
        Number(isMetalsPaint(b.row)) - Number(isMetalsPaint(a.row)) || a.index - b.index
      ).map(({ row }) => row);
    }
    return list;
  }
  return { status, hasExaminer, isMine, isMetalsPaint, ordered };
});
