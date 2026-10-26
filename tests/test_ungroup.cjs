const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setupTestEnvironment() {
  const context = {
    data: {
      clients: [{ id: 'c1', name: 'TAYARI EVENTS' }],
      groups: [
        { id: 'g1', clientId: 'c1', label: 'RAMLEELA EVENT 2026', agreedAmount: 7000 },
        { id: 'g2', clientId: 'c1', label: 'RAMLEELA EVENT 2027', agreedAmount: 8000 }
      ],
      projectGroups: [
        { id: 'p1', clientId: 'c1', label: 'ramleela' }
      ],
      items: [
        { id: 'i1', clientId: 'c1', projectGroupId: 'p1', groupId: 'g1', service: 'ARCH FLEX', quantity: 1, rate: 4000, quotedTotal: 4000, advanceAmount: 0, status: 'paid', paidAt: '2026-10-26' },
        { id: 'i2', clientId: 'c1', projectGroupId: 'p1', groupId: 'g1', service: 'PHOTOBOOTH', quantity: 1, rate: 3000, quotedTotal: 3000, advanceAmount: 0, status: 'paid', paidAt: '2026-10-26' },
        { id: 'i3', clientId: 'c1', projectGroupId: 'p1', groupId: 'g2', service: 'LIGHTING', quantity: 1, rate: 5000, quotedTotal: 5000, advanceAmount: 0, status: 'pending' },
        { id: 'i4', clientId: 'c1', projectGroupId: 'p1', groupId: 'g2', service: 'SOUND', quantity: 1, rate: 5000, quotedTotal: 5000, advanceAmount: 0, status: 'pending' },
        { id: 'i5', clientId: 'c1', projectGroupId: 'p1', groupId: null, service: 'SECURITY', quantity: 1, rate: 1500, quotedTotal: 1500, advanceAmount: 0, status: 'pending' },
        { id: 'i6', clientId: 'c1', projectGroupId: null, groupId: null, service: 'FLYER', quantity: 1, rate: 500, quotedTotal: 500, advanceAmount: 0, status: 'pending' }
      ],
      invoices: [],
      receipts: [
        { id: 'r-deal-1', clientId: 'c1', clientName: 'TAYARI EVENTS', amount: 7000, receivedMonth: '2026-10-01', receivedOn: '2026-10-26', referenceKind: 'deal', referenceId: 'g1', description: 'RAMLEELA EVENT 2026' }
      ],
      pending: [],
      pendingDeletes: [],
      settings: { workspaceId: 'ws-test' }
    },
    activeClient: 'c1',
    selected: new Set(),
    collapsedGroups: new Set(['deal:g1']),
    undoStack: [],
    redoStack: [],
    MAX_UNDO_STACK: 50,
    num: v => Number(v) || 0,
    uid: (() => { let n = 0; return () => `uid-${++n}`; })(),
    today: () => '2026-10-26',
    currentUserId: () => 'user-test',
    enqueue: (table, id) => {
      const key = table + ':' + id;
      if (!context.data.pending.some(p => p.key === key)) context.data.pending.push({ key, table, id });
    },
    queue: (table, id) => {
      context.enqueue(table, id);
    },
    save: () => {},
    scheduleSync: () => {},
    render: () => {},
    toast: () => {},
    closeModal: () => {},
    updateUndoRedoUI: () => {},
    invoiceAdvance: () => 0,
    billedIds: () => new Set(),
    esc: s => s,
    $: () => ({}),
    modal: (title, content, actions) => {}
  };

  vm.createContext(context);

  const take = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

  // Load functions from app.js
  const codeToRun = 
    take('function receiptEffectiveItem(', 'function financials(') +
    take('function financials()', 'function counts()') +
    take('function effectiveItemValue(', 'function assign(') +
    take('function pushUndo(', 'function undo(') +
    take('function snapshotState()', 'function pushUndo(') +
    take('function syncDealReceipt(', 'function bulkSetStatus(') +
    take('function removeReceipt(', 'function modal(') +
    take('function hasGroupedSelected()', 'function selectSheetRow(') +
    take('function ungroupDialog(', 'function invoiceDialog(');

  vm.runInContext(codeToRun, context);
  return context;
}

console.log('Testing Ungroup Functionality...\n');

// Test 1: hasGroupedSelected correctly identifies selected grouped rows
(() => {
  const ctx = setupTestEnvironment();
  assert.equal(vm.runInContext("hasGroupedSelected()", ctx), false, 'Empty selection returns false');

  ctx.selected.add('i6'); // standalone row
  assert.equal(vm.runInContext("hasGroupedSelected()", ctx), false, 'Selecting only standalone row returns false');

  ctx.selected.add('i1'); // in deal and project
  assert.equal(vm.runInContext("hasGroupedSelected()", ctx), true, 'Selecting grouped row returns true');

  console.log('✓ Test 1: hasGroupedSelected correctly detects grouped rows');
})();

// Test 2: Ungroup entire deal group via ungroupDialog
(() => {
  const ctx = setupTestEnvironment();
  let modalConfirmCallback = null;
  ctx.$ = id => {
    if (id === '#confirmUngroup') {
      return { set onclick(fn) { modalConfirmCallback = fn; } };
    }
    return {};
  };

  vm.runInContext("ungroupDialog('deal', 'g1')", ctx);
  assert.ok(modalConfirmCallback, 'Ungroup confirmation modal rendered');

  // Confirm ungroup
  modalConfirmCallback();

  // Check items unlinked from g1
  const i1 = ctx.data.items.find(i => i.id === 'i1');
  const i2 = ctx.data.items.find(i => i.id === 'i2');
  assert.equal(i1.groupId, null, 'i1 groupId cleared');
  assert.equal(i2.groupId, null, 'i2 groupId cleared');
  assert.equal(i1.projectGroupId, 'p1', 'i1 still in projectGroup p1');

  // Check deal group g1 deleted
  assert.equal(ctx.data.groups.some(g => g.id === 'g1'), false, 'g1 removed from data.groups');
  assert.ok(ctx.data.pendingDeletes.some(d => d.table === 'groups' && d.id === 'g1'), 'g1 queued in pendingDeletes for Supabase removal');
  assert.equal(ctx.collapsedGroups.has('deal:g1'), false, 'deal:g1 removed from collapsedGroups');

  // Check old deal receipt removed
  assert.equal(ctx.data.receipts.some(r => r.referenceKind === 'deal' && r.referenceId === 'g1'), false, 'Deal receipt removed');

  // Check project group receipt now captures i1 & i2 because they are now non-deal items in p1!
  // i1 rate 4000 + i2 rate 3000 = 7000
  const projReceipt = ctx.data.receipts.find(r => r.referenceKind === 'project' && r.referenceId === 'p1');
  assert.ok(projReceipt, 'Project group receipt created for paid rows in p1');
  assert.equal(projReceipt.amount, 7000, 'Project group receipt amount is 7000');

  // Check undo stack has entry
  assert.equal(ctx.undoStack.length, 1, 'Action pushed to undo stack');

  console.log('✓ Test 2: Ungroup deal group via dialog cleans up group, receipts, and retains project links');
})();

// Test 3: Ungroup selected rows via ungroupSelectedRows
(() => {
  const ctx = setupTestEnvironment();
  
  // Set i3 and i4 to only have deal group g2
  ctx.data.items.find(i => i.id === 'i3').projectGroupId = null;
  ctx.data.items.find(i => i.id === 'i4').projectGroupId = null;

  // Select row i3 from g2 (g2 has i3 and i4)
  ctx.selected.add('i3');
  vm.runInContext("ungroupSelectedRows()", ctx);

  const i3 = ctx.data.items.find(i => i.id === 'i3');
  const i4 = ctx.data.items.find(i => i.id === 'i4');
  assert.equal(i3.groupId, null, 'i3 groupId cleared');
  assert.equal(i4.groupId, 'g2', 'i4 still in g2');
  assert.ok(ctx.data.groups.some(g => g.id === 'g2'), 'g2 still exists because i4 remains');

  // Now select i4 and ungroup it as well
  ctx.selected.clear();
  ctx.selected.add('i4');
  vm.runInContext("ungroupSelectedRows()", ctx);

  assert.equal(i4.groupId, null, 'i4 groupId cleared');
  assert.equal(ctx.data.groups.some(g => g.id === 'g2'), false, 'g2 automatically removed once all rows ungrouped');
  assert.ok(ctx.data.pendingDeletes.some(d => d.table === 'groups' && d.id === 'g2'), 'g2 queued for Supabase deletion');

  console.log('✓ Test 3: ungroupSelectedRows unlinks rows and cleans up empty groups');
})();

// Test 4: Ungroup entire project group via ungroupDialog
(() => {
  const ctx = setupTestEnvironment();
  let modalConfirmCallback = null;
  ctx.$ = id => {
    if (id === '#confirmUngroup') {
      return { set onclick(fn) { modalConfirmCallback = fn; } };
    }
    return {};
  };

  vm.runInContext("ungroupDialog('project', 'p1')", ctx);
  assert.ok(modalConfirmCallback, 'Ungroup confirmation modal rendered');

  modalConfirmCallback();

  // Check all items have projectGroupId cleared
  assert.ok(ctx.data.items.every(i => i.projectGroupId === null), 'All items projectGroupId set to null');
  assert.equal(ctx.data.projectGroups.some(p => p.id === 'p1'), false, 'p1 removed from data.projectGroups');
  assert.ok(ctx.data.pendingDeletes.some(d => d.table === 'projectGroups' && d.id === 'p1'), 'p1 queued in pendingDeletes');

  // Nested deal group g1 still intact
  const i1 = ctx.data.items.find(i => i.id === 'i1');
  assert.equal(i1.groupId, 'g1', 'i1 still in deal group g1');
  assert.ok(ctx.data.groups.some(g => g.id === 'g1'), 'Deal group g1 remains intact');

  console.log('✓ Test 4: Ungroup project group keeps nested deal groups intact');
})();

console.log('\nALL UNGROUP TESTS PASSED! 🎉');
