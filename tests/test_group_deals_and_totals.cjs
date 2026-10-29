const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setupTestEnvironment() {
  const context = {
    data: {
      clients: [{ id: 'c1', name: 'Bling it on' }, { id: 'c2', name: 'MICHEAL' }],
      groups: [
        { id: 'g1', clientId: 'c2', label: 'BAGA IGNITE X 2026', agreedAmount: 70000 }
      ],
      projectGroups: [
        { id: 'p1', clientId: 'c1', label: 'renders' }
      ],
      items: [
        // 3 items in p1 (renders)
        { id: 'i1', clientId: 'c1', projectGroupId: 'p1', groupId: null, service: '3D MANDAP', quantity: 1, rate: 3000, quotedTotal: 3000, advanceAmount: 0, status: 'paid', paidAt: '2026-10-10' },
        { id: 'i2', clientId: 'c1', projectGroupId: 'p1', groupId: null, service: '3D MANDAP', quantity: 1, rate: 3000, quotedTotal: 3000, advanceAmount: 0, status: 'paid', paidAt: '2026-10-10' },
        { id: 'i3', clientId: 'c1', projectGroupId: 'p1', groupId: null, service: '3D MANDAP', quantity: 1, rate: 2820, quotedTotal: 2820, advanceAmount: 0, status: 'paid', paidAt: '2026-10-10' },
        // 1 item in g1 (BAGA IGNITE)
        { id: 'i4', clientId: 'c2', projectGroupId: null, groupId: 'g1', service: 'STAGE', quantity: 1, rate: 70000, quotedTotal: 70000, advanceAmount: 0, status: 'paid', paidAt: '2026-10-10' }
      ],
      invoices: [],
      receipts: [],
      pending: [],
      pendingDeletes: [],
      settings: { workspaceId: 'ws-test', displayName: 'Samuel' }
    },
    selected: new Set(),
    collapsedGroups: new Set(),
    tab: 'sheet',
    activeClient: 'c1',
    uid: (() => { let n = 0; return () => `uid-${++n}`; })(),
    undoStack: [],
    redoStack: [],
    MAX_UNDO_STACK: 30,
    money: n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }),
    num: v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0,
    esc: v => String(v ?? ''),
    cleanSerial: v => String(v || ''),
    today: () => '2026-10-29',
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
    render: () => {},
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
    modalInputs: {},
    inputValue: id => context.modalInputs[id] ?? '',
    elements: {},
    $: selector => {
      context.elements[selector] ||= {};
      return context.elements[selector];
    }
  };

  vm.createContext(context);

  const take = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

  // Load functions from app.js
  const codeToRun = 
    take('function snapshotState(', 'function updateUndoRedoUI(') +
    take('function effectiveItemValue(', 'function assign(') +
    take('function syncDealReceipt(', 'function syncProjectReceipt(') +
    take('function syncProjectReceipt(', 'function syncItemReceipt(') +
    take('function removeReceipt(', 'function modal(') +
    take('function groupTotalValue(', 'function blankRowHtml(') +
    take('function openGroupDealDialog(', 'function renameGroup(') +
    take('function renderGroups()', 'function renderClientDetails()');

  vm.runInContext(codeToRun, context);
  return context;
}

console.log('Testing Group Deals and Total Amount Display...');

// Test 1: groupTotalValue and groupHeader for Project Group 'renders'
{
  const ctx = setupTestEnvironment();
  const p1 = ctx.data.projectGroups[0];
  const items = ctx.data.items.filter(i => i.projectGroupId === 'p1');

  const gVal = ctx.groupTotalValue('project', p1, items);
  assert.equal(gVal.total, 8820, 'p1 total should be 8820 (3000 + 3000 + 2820)');
  assert.equal(gVal.paid, 8820, 'p1 paid should be 8820 because all 3 items are paid');
  assert.equal(gVal.agreed, false, 'p1 is a project group, agreed should be false');

  const headerHtml = ctx.groupHeader('project', p1, items);
  assert(headerHtml.includes('Total ₹8,820'), `Header should include 'Total ₹8,820', got: ${headerHtml}`);
  assert(headerHtml.includes('data-group-deal="project:p1"'), 'Header must include Group Deal button');
  console.log('✓ Test 1: Project group renders shows correct Total ₹8,820 and Group deal button');
}

// Test 2: groupTotalValue and groupHeader for Deal Group with agreed amount
{
  const ctx = setupTestEnvironment();
  const g1 = ctx.data.groups[0];
  const items = ctx.data.items.filter(i => i.groupId === 'g1');

  const gVal = ctx.groupTotalValue('deal', g1, items);
  assert.equal(gVal.total, 70000, 'g1 total should be 70000 agreed amount');
  assert.equal(gVal.agreed, true, 'g1 agreed should be true');

  const headerHtml = ctx.groupHeader('deal', g1, items);
  assert(headerHtml.includes('Agreed ₹70,000'), `Header should include 'Agreed ₹70,000', got: ${headerHtml}`);
  assert(headerHtml.includes('data-group-deal="deal:g1"'), 'Header must include Group Deal button');
  console.log('✓ Test 2: Deal group BAGA IGNITE shows Agreed ₹70,000 and Group deal button');
}

// Test 3: renderGroups() shows totals on project cards and agreed amount on deal cards
{
  const ctx = setupTestEnvironment();
  const html = ctx.renderGroups();

  assert(html.includes('PROJECT GROUP'), 'Must have PROJECT GROUP badge');
  assert(html.includes('<span>Total ₹8,820</span>'), 'Project card must show <span>Total ₹8,820</span>');
  assert(html.includes('data-group-deal-card="project:p1"'), 'Project card must have Group deal button');

  assert(html.includes('DEAL GROUP'), 'Must have DEAL GROUP badge');
  assert(html.includes('<span>Agreed ₹70,000</span>'), 'Deal card must show <span>Agreed ₹70,000</span>');
  assert(html.includes('data-group-deal-card="deal:g1"'), 'Deal card must have Group deal button');
  console.log('✓ Test 3: Groups tab cards show formatted total amounts and group deal buttons');
}

// Test 4: Partially paid project group shows both total and paid amounts
{
  const ctx = setupTestEnvironment();
  const p1 = ctx.data.projectGroups[0];
  // Mark 2 of the 3 items pending
  ctx.data.items[1].status = 'pending';
  ctx.data.items[2].status = 'pending';
  const items = ctx.data.items.filter(i => i.projectGroupId === 'p1');

  const gVal = ctx.groupTotalValue('project', p1, items);
  assert.equal(gVal.total, 8820);
  assert.equal(gVal.paid, 3000);

  const headerHtml = ctx.groupHeader('project', p1, items);
  assert(headerHtml.includes('Total ₹8,820 (₹3,000 paid)'), `Header should include paid breakdown, got: ${headerHtml}`);
  console.log('✓ Test 4: Partially paid project group shows breakdown: Total ₹8,820 (₹3,000 paid)');
}

// Test 5: openGroupDealDialog converts project group to deal group with negotiated amount
{
  const ctx = setupTestEnvironment();
  // Ensure syncProjectReceipt ran initially
  ctx.syncProjectReceipt('p1');
  assert.equal(ctx.data.receipts.length, 1);
  assert.equal(ctx.data.receipts[0].referenceKind, 'project');
  assert.equal(ctx.data.receipts[0].amount, 8820);

  // User clicks Group Deal on p1
  ctx.openGroupDealDialog('project', 'p1');
  assert(ctx.modalTitle.includes('Group Deal'));

  // User sets agreed deal amount to 8000
  ctx.modalInputs['groupDealLabel'] = 'renders';
  ctx.modalInputs['groupDealAmount'] = '8000';

  // Find save callback from #saveGroupDeal
  const saveBtn = ctx.$('#saveGroupDeal');
  saveBtn.onclick();

  // Verification 1: p1 is now a deal group in data.groups
  const dealGroup = ctx.data.groups.find(g => g.id === 'p1');
  assert(dealGroup, 'p1 should now exist in data.groups');
  assert.equal(dealGroup.label, 'renders');
  assert.equal(dealGroup.agreedAmount, 8000);

  // Verification 2: p1 is removed from data.projectGroups and marked in pendingDeletes
  assert(!ctx.data.projectGroups.some(g => g.id === 'p1'), 'p1 should no longer be in data.projectGroups');
  assert(ctx.data.pendingDeletes.some(d => d.table === 'projectGroups' && d.id === 'p1'), 'p1 must be in pendingDeletes for projectGroups');

  // Verification 3: All 3 items now point to groupId: 'p1' and projectGroupId: null
  const items = ctx.data.items.filter(i => i.clientId === 'c1');
  assert.equal(items.length, 3);
  for (const it of items) {
    assert.equal(it.groupId, 'p1');
    assert.equal(it.projectGroupId, null);
  }

  // Verification 4: Receipt is converted to deal receipt for 8000
  const receipts = ctx.data.receipts.filter(r => r.clientId === 'c1');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].referenceKind, 'deal');
  assert.equal(receipts[0].referenceId, 'p1');
  assert.equal(receipts[0].amount, 8000);

  // Verification 5: Header now displays Agreed ₹8,000 as a deal group
  const newHeader = ctx.groupHeader('deal', dealGroup, items);
  assert(newHeader.includes('Agreed ₹8,000'), `Header should now show Agreed ₹8,000, got: ${newHeader}`);
  console.log('✓ Test 5: Project group converts seamlessly to deal group with agreed amount and updated receipts');
}

// Test 6: Undo cleanly restores the converted project group and its original receipts
{
  const ctx = setupTestEnvironment();
  ctx.syncProjectReceipt('p1');

  ctx.openGroupDealDialog('project', 'p1');
  ctx.modalInputs['groupDealLabel'] = 'renders';
  ctx.modalInputs['groupDealAmount'] = '8000';
  ctx.$('#saveGroupDeal').onclick();

  assert(ctx.data.groups.some(g => g.id === 'p1'));

  // Trigger Undo
  ctx.undo();

  // Project group should be restored
  assert(ctx.data.projectGroups.some(g => g.id === 'p1'), 'p1 must be back in projectGroups after undo');
  assert(!ctx.data.groups.some(g => g.id === 'p1'), 'p1 must NOT be in groups after undo');

  const items = ctx.data.items.filter(i => i.clientId === 'c1');
  for (const it of items) {
    assert.equal(it.projectGroupId, 'p1');
    assert.equal(it.groupId, null);
  }
  console.log('✓ Test 6: Undo cleanly reverts deal group conversion back to project group');
}

console.log('\nALL GROUP DEALS AND TOTAL AMOUNT TESTS PASSED! 🎉');
