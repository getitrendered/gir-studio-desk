const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setupTestEnvironment() {
  const context = {
    data: {
      clients: [{ id: 'c1', name: 'Bling it on' }, { id: 'c2', name: 'TAYARI EVENTS' }],
      groups: [
        { id: 'g1', clientId: 'c1', label: 'renders', agreedAmount: 8820 }
      ],
      projectGroups: [
        { id: 'p1', clientId: 'c2', label: 'ramleela' }
      ],
      items: [
        // Deal group items
        { id: 'i1', clientId: 'c1', projectGroupId: null, groupId: 'g1', service: '3D MANDAP', quantity: 1, rate: 3000, quotedTotal: 3000, advanceAmount: 0, status: 'paid', paidAt: '2026-10-29' },
        { id: 'i2', clientId: 'c1', projectGroupId: null, groupId: 'g1', service: '3D MANDAP', quantity: 1, rate: 3000, quotedTotal: 3000, advanceAmount: 0, status: 'paid', paidAt: '2026-10-29' },
        { id: 'i3', clientId: 'c1', projectGroupId: null, groupId: 'g1', service: '3D MANDAP', quantity: 1, rate: 2820, quotedTotal: 2820, advanceAmount: 0, status: 'paid', paidAt: '2026-10-29' },
        // Project group items (initially pending)
        { id: 'i4', clientId: 'c2', projectGroupId: 'p1', groupId: null, service: 'LIGHTING', quantity: 1, rate: 5000, quotedTotal: 5000, advanceAmount: 0, status: 'pending', paidAt: null }
      ],
      invoices: [],
      receipts: [
        // Active deal receipt for renders
        { id: 'r1', clientId: 'c1', clientName: 'Bling it on', amount: 8820, receivedMonth: '2026-10-01', receivedOn: '2026-10-29', receivedAt: '2026-10-29T12:00:00.000Z', referenceKind: 'deal', referenceId: 'g1', description: 'Agreed deal', source: 'app' },
        // Historical imported payment causing duplicate issue
        { id: 'r2', clientId: 'c1', clientName: 'Bling it on', amount: 8820, receivedMonth: '2026-10-01', receivedOn: '2026-10-13', receivedAt: '2026-10-13T12:00:00.000Z', referenceKind: null, referenceId: null, description: 'Historical payment', source: 'historical_workbook' }
      ],
      pending: [],
      pendingDeletes: [],
      settings: { workspaceId: 'ws-test', displayName: 'Samuel' }
    },
    selected: new Set(),
    collapsedGroups: new Set(['deal:g1']),
    tab: 'revenue',
    activeClient: 'c1',
    undoStack: [],
    redoStack: [],
    MAX_UNDO_STACK: 30,
    money: n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }),
    num: v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0,
    esc: v => String(v ?? ''),
    cleanSerial: v => String(v || ''),
    fmtDate: d => d ? `${d.slice(8,10)} ${d.slice(5,7)} ${d.slice(0,4)}` : '—',
    today: () => '2026-10-29',
    uid: (() => { let n = 0; return () => `uid-${++n}`; })(),
    currentUserId: () => 'user-test',
    enqueue: (table, id) => {
      context.data.pending.push({ table, id });
    },
    mutate: (table, row) => {
      const list = context.data[table] || [];
      const idx = list.findIndex(x => x.id === row.id);
      if (idx >= 0) list[idx] = row;
      else list.push(row);
      context.data.pending.push({ table, id: row.id });
    },
    save: () => {},
    scheduleSync: () => {},
    setTimeout,
    clearTimeout,
    document: { querySelector: () => null },
    render: () => {},
    renderOutstandingPanel: () => '',
    toast: msg => { context.lastToast = msg; },
    updateUndoRedoUI: () => {},
    modalHtml: '',
    modalTitle: '',
    modal: (title, body, actions) => {
      context.modalTitle = title;
      context.modalHtml = body + (actions || '');
    },
    closeModal: () => {
      context.modalTitle = '';
      context.modalHtml = '';
    },
    elements: {},
    $: selector => {
      if (!context.elements[selector]) {
        context.elements[selector] = {
          addEventListener: () => {},
          removeEventListener: () => {}
        };
      }
      return context.elements[selector];
    }
  };

  vm.createContext(context);

  const take = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

  const codeToRun = 
    take('function billedIds()', 'function financials(') +
    take('function financials()', 'function counts()') +
    take('function groupTotalValue(', 'function blankRowHtml(') +
    take('function snapshotState(', 'function updateUndoRedoUI(') +
    take('function effectiveItemValue(', 'function assign(') +
    take('function syncDealReceipt(', 'function syncProjectReceipt(') +
    take('function syncProjectReceipt(', 'function syncItemReceipt(') +
    take('function removeReceipt(', 'function modal(') +
    take('function modifyReceiptDateDialog(', 'function renameGroup(') +
    take('function renderGroups()', 'function renderClientDetails()') +
    take('function renderRevenue()', 'function renderOutstandingPanel(');

  vm.runInContext(codeToRun, context);
  return context;
}

console.log('Testing Revenue Controls, Payment Date Modification, and Group Dates...');

// Test 1: Modify payment date on a receipt updates receipt and linked items
{
  const ctx = setupTestEnvironment();
  const r1 = ctx.data.receipts.find(r => r.id === 'r1');

  ctx.modifyReceiptDateDialog('r1');
  assert(ctx.modalTitle.includes('Modify Payment Date'));

  // User sets date to November 15, 2026
  ctx.elements['#modifyReceiptDateInput'] = { value: '2026-11-15' };
  ctx.$('#saveReceiptDate').onclick();

  assert.equal(r1.receivedOn, '2026-11-15');
  assert.equal(r1.receivedMonth, '2026-11-01');

  // Verify all 3 deal items now reflect paidAt = 2026-11-15
  const items = ctx.data.items.filter(i => i.groupId === 'g1');
  assert.equal(items.length, 3);
  for (const it of items) {
    assert.equal(it.paidAt, '2026-11-15', 'Linked item paidAt must update');
  }

  // Check renderRevenue output now includes November 2026
  const revHtml = ctx.renderRevenue();
  assert(revHtml.includes('November 2026'), 'Revenue must show November 2026 after date change');
  console.log('✓ Test 1: Modifying payment date updates receipt month and all linked items');
}

// Test 2: Deleting historical payment receipt removes duplicate from revenue
{
  const ctx = setupTestEnvironment();
  assert.equal(ctx.data.receipts.length, 2);

  ctx.deleteReceiptDialog('r2');
  assert(ctx.modalTitle.includes('Delete Payment Receipt'));

  // Confirm delete
  ctx.$('#confirmDeleteReceipt').onclick();

  assert.equal(ctx.data.receipts.length, 1);
  assert(!ctx.data.receipts.some(r => r.id === 'r2'), 'r2 must be deleted');
  assert(ctx.data.pendingDeletes.some(d => d.table === 'receipts' && d.id === 'r2'), 'r2 in pendingDeletes');

  // Revenue must now only contain the single remaining receipt
  const f = ctx.financials();
  assert.equal(f.revenue, 8820, 'Revenue must now be 8820 instead of double-counted 17640');
  console.log('✓ Test 2: Deleting historical payment receipt cleans up double-counting in revenue');
}

// Test 3: Deleting an active deal receipt with unmarkWork option reverts items to Sent
{
  const ctx = setupTestEnvironment();
  const r1 = ctx.data.receipts.find(r => r.id === 'r1');

  ctx.deleteReceiptDialog('r1');
  ctx.elements['#unmarkWorkCheckbox'] = { checked: true };
  ctx.$('#confirmDeleteReceipt').onclick();

  assert(!ctx.data.receipts.some(r => r.id === 'r1'));
  const items = ctx.data.items.filter(i => i.groupId === 'g1');
  for (const it of items) {
    assert.equal(it.status, 'sent', 'Items must revert to sent status');
    assert.equal(it.paidAt, null, 'paidAt must be cleared');
  }
  console.log('✓ Test 3: Deleting active deal receipt with unmarkWork reverts rows to Sent in worksheet');
}

// Test 4: jumpToReceiptWorksheet switches active client, tab to sheet, and un-collapses group
{
  const ctx = setupTestEnvironment();
  assert(ctx.collapsedGroups.has('deal:g1'), 'g1 initially collapsed');

  ctx.jumpToReceiptWorksheet('r1');
  assert.equal(ctx.tab, 'sheet', 'Must navigate to sheet tab');
  assert.equal(ctx.activeClient, 'c1', 'Must switch activeClient to c1');
  assert(!ctx.collapsedGroups.has('deal:g1'), 'Target group g1 must be un-collapsed');
  console.log('✓ Test 4: jumpToReceiptWorksheet navigates directly to the group worksheet');
}

// Test 5: setGroupPaidDateDialog sets paid date and updates receipt
{
  const ctx = setupTestEnvironment();
  const p1 = ctx.data.projectGroups[0];

  // Group p1 has 1 pending item
  assert.equal(ctx.data.items.find(i => i.id === 'i4').status, 'pending');

  ctx.setGroupPaidDateDialog('project', 'p1');
  assert(ctx.modalTitle.includes('Payment Date'));

  // Set paid date to October 15, 2026
  ctx.elements['#groupPaidDateInput'] = { value: '2026-10-15' };
  ctx.$('#saveGroupPaidDate').onclick();

  const item4 = ctx.data.items.find(i => i.id === 'i4');
  assert.equal(item4.status, 'paid');
  assert.equal(item4.paidAt, '2026-10-15');

  // Verify project receipt was created for 5000 on 2026-10-15
  const rProject = ctx.data.receipts.find(r => r.referenceKind === 'project' && r.referenceId === 'p1');
  assert(rProject, 'Project receipt must be generated');
  assert.equal(rProject.receivedOn, '2026-10-15');
  assert.equal(rProject.amount, 5000);
  console.log('✓ Test 5: setGroupPaidDateDialog sets payment date on group and generates correct receipt');
}

// Test 6: UI contains all action buttons in Revenue table and Group headers
{
  const ctx = setupTestEnvironment();
  const revHtml = ctx.renderRevenue();
  assert(revHtml.includes('data-receipt-date="r1"'), 'Revenue table must have Date button');
  assert(revHtml.includes('data-receipt-jump="r1"'), 'Revenue table must have View button');
  assert(revHtml.includes('data-receipt-ungroup="r1"'), 'Revenue table must have Ungroup button');
  assert(revHtml.includes('data-receipt-delete="r1"'), 'Revenue table must have Delete button');

  const g1 = ctx.data.groups[0];
  const items = ctx.data.items.filter(i => i.groupId === 'g1');
  const headerHtml = ctx.groupHeader('deal', g1, items);
  assert(headerHtml.includes('data-group-paid-date="deal:g1"'), 'Group header must have Paid date button');

  const cardsHtml = ctx.renderGroups();
  assert(cardsHtml.includes('data-group-paid-date="deal:g1"'), 'Group cards must have Paid date button');
  console.log('✓ Test 6: All UI controls present in Revenue table and Group headers');
}

console.log('\nALL REVENUE CONTROLS AND GROUP DATE TESTS PASSED! 🎉');
