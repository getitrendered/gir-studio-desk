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
        // g1 items in p1
        { id: 'i1', clientId: 'c1', projectGroupId: 'p1', groupId: 'g1', service: 'ARCH FLEX', quantity: 1, rate: 4000, quotedTotal: 4000, advanceAmount: 0, status: 'pending' },
        { id: 'i2', clientId: 'c1', projectGroupId: 'p1', groupId: 'g1', service: 'PHOTOBOOTH', quantity: 1, rate: 3000, quotedTotal: 3000, advanceAmount: 0, status: 'pending' },
        // g2 items in p1
        { id: 'i3', clientId: 'c1', projectGroupId: 'p1', groupId: 'g2', service: 'LIGHTING', quantity: 1, rate: 5000, quotedTotal: 5000, advanceAmount: 0, status: 'pending' },
        { id: 'i4', clientId: 'c1', projectGroupId: 'p1', groupId: 'g2', service: 'SOUND', quantity: 1, rate: 5000, quotedTotal: 5000, advanceAmount: 0, status: 'pending' },
        // standalone item in p1
        { id: 'i5', clientId: 'c1', projectGroupId: 'p1', groupId: null, service: 'SECURITY', quantity: 1, rate: 1500, quotedTotal: 1500, advanceAmount: 0, status: 'pending' }
      ],
      invoices: [],
      receipts: [],
      pending: [],
      pendingDeletes: [],
      settings: { workspaceId: 'ws-test' }
    },
    selected: new Set(),
    num: v => Number(v) || 0,
    uid: (() => { let n = 0; return () => `uid-${++n}`; })(),
    today: () => '2026-10-26',
    currentUserId: () => 'user-test',
    enqueue: (table, id) => {},
    save: () => {},
    scheduleSync: () => {},
    render: () => {},
    toast: () => {},
    invoiceAdvance: () => 0,
    billedIds: () => new Set()
  };

  vm.createContext(context);

  const take = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

  // Load functions from app.js
  const codeToRun = 
    take('function receiptEffectiveItem(', 'function financials(') +
    take('function financials()', 'function counts()') +
    take('function effectiveItemValue(', 'function assign(') +
    take('function bulkSetStatus(', 'function modal(');

  vm.runInContext(codeToRun, context);
  return context;
}

console.log('Testing Nested Groups and Revenue Receipts Consolidation...');

// Test 1: Mark Project Group paid when it contains nested Deal Groups and standalone items
(() => {
  const ctx = setupTestEnvironment();
  const allIds = ['i1', 'i2', 'i3', 'i4', 'i5'];

  vm.runInContext("bulkSetStatus('paid', ['i1','i2','i3','i4','i5'], { kind: 'project', id: 'p1', label: 'ramleela' })", ctx);

  assert.equal(ctx.data.receipts.length, 3, 'Creates exactly 3 receipts: 1 for deal 2026, 1 for deal 2027, 1 for standalone');
  
  const rDeal1 = ctx.data.receipts.find(r => r.referenceKind === 'deal' && r.referenceId === 'g1');
  const rDeal2 = ctx.data.receipts.find(r => r.referenceKind === 'deal' && r.referenceId === 'g2');
  const rProj = ctx.data.receipts.find(r => r.referenceKind === 'project' && r.referenceId === 'p1');

  assert.ok(rDeal1, 'Deal 1 receipt exists');
  assert.equal(rDeal1.amount, 7000, 'Deal 1 amount is exactly agreed 7000');
  assert.equal(rDeal1.description, 'RAMLEELA EVENT 2026');

  assert.ok(rDeal2, 'Deal 2 receipt exists');
  assert.equal(rDeal2.amount, 8000, 'Deal 2 amount is exactly agreed 8000');
  assert.equal(rDeal2.description, 'RAMLEELA EVENT 2027');

  assert.ok(rProj, 'Project standalone receipt exists');
  assert.equal(rProj.amount, 1500, 'Project standalone amount is 1500');
  assert.equal(rProj.description, 'ramleela');

  const f = vm.runInContext('financials()', ctx);
  assert.equal(f.revenue, 16500, 'Total revenue equals 7000 + 8000 + 1500 = 16500');

  console.log('✓ Test 1: Marking Project Group paid correctly separates nested deals and standalone items (7000 + 8000 + 1500 = 16500)');
})();

// Test 2: Marking rows inside a deal group sequentially does NOT duplicate receipts
(() => {
  const ctx = setupTestEnvironment();

  // Mark first row in g1 paid
  vm.runInContext("bulkSetStatus('paid', ['i1'])", ctx);
  assert.equal(ctx.data.receipts.length, 1, 'Only 1 receipt created');
  assert.equal(ctx.data.receipts[0].referenceKind, 'deal');
  assert.equal(ctx.data.receipts[0].referenceId, 'g1');
  assert.equal(ctx.data.receipts[0].amount, 4000, 'Effective share for first row (4000 of 7000 quote with 7000 agreed)');

  // Mark second row in g1 paid
  vm.runInContext("bulkSetStatus('paid', ['i2'])", ctx);
  assert.equal(ctx.data.receipts.length, 1, 'Still only 1 receipt, NO duplication!');
  assert.equal(ctx.data.receipts[0].amount, 7000, 'Full agreed amount when all deal rows are paid');

  console.log('✓ Test 2: Marking deal rows one-by-one updates the single deal receipt without duplicating');
})();

// Test 3: Self-healing consolidation cleans up pre-existing duplicate receipts (User bug scenario)
(() => {
  const ctx = setupTestEnvironment();

  // Simulate user's exact state: 13 duplicate receipts for g1 in data.receipts
  ctx.data.items.forEach(i => { if (i.groupId === 'g1') i.status = 'paid'; });
  for (let k = 0; k < 13; k++) {
    ctx.data.receipts.push({
      id: `dup-${k}`,
      clientId: 'c1',
      clientName: 'TAYARI EVENTS',
      amount: 482.76,
      receivedMonth: '2026-10-01',
      receivedOn: '2026-10-26',
      referenceKind: 'deal',
      referenceId: 'g1',
      description: 'RAMLEELA EVENT 2026'
    });
  }

  // Before consolidation, receiptEffectiveAmount safeguard prevents multiplying
  const amtDup0 = vm.runInContext("receiptEffectiveAmount(data.receipts[0])", ctx);
  const amtDup1 = vm.runInContext("receiptEffectiveAmount(data.receipts[1])", ctx);
  assert.equal(amtDup0, 7000, 'First receipt returns 7000');
  assert.equal(amtDup1, 0, 'Subsequent duplicate receipts return 0');

  // Run consolidateAllReceipts
  vm.runInContext("consolidateAllReceipts()", ctx);

  assert.equal(ctx.data.receipts.length, 1, 'Consolidated down to exactly 1 receipt');
  assert.equal(ctx.data.receipts[0].amount, 7000, 'Amount set to agreed 7000');
  assert.equal(ctx.data.pendingDeletes.length, 12, '12 duplicate receipts sent to pendingDeletes for Supabase removal');

  console.log('✓ Test 3: Pre-existing duplicate receipts self-heal and delete redundant copies from Supabase');
})();

// Test 4: Unmarking paid rows in deal group adjusts or removes receipt
(() => {
  const ctx = setupTestEnvironment();

  // Mark all deal 1 rows paid
  vm.runInContext("bulkSetStatus('paid', ['i1', 'i2'])", ctx);
  assert.equal(ctx.data.receipts.length, 1);
  assert.equal(ctx.data.receipts[0].amount, 7000);

  // Unmark i1 (set to working)
  vm.runInContext("bulkSetStatus('working', ['i1'])", ctx);
  assert.equal(ctx.data.receipts.length, 1, 'Receipt still exists for remaining paid item');
  assert.equal(ctx.data.receipts[0].amount, 3000, 'Receipt amount reduced to i2 share');

  // Unmark i2 (set to pending)
  vm.runInContext("bulkSetStatus('pending', ['i2'])", ctx);
  assert.equal(ctx.data.receipts.length, 0, 'Receipt automatically removed when 0 items remain paid');

  console.log('✓ Test 4: Unmarking deal items adjusts or deletes the deal receipt');
})();

// Test 5: Redundant or orphaned receipt for an item that is part of a deal group (e.g. PODIUM) is ignored and cleaned up
(() => {
  const ctx = setupTestEnvironment();

  // Deal g1 has i1 (ARCH FLEX) and i2 (PHOTOBOOTH)
  // Add a deal item PODIUM to g1
  ctx.data.items.push({
    id: 'i-podium',
    clientId: 'c1',
    projectGroupId: 'p1',
    groupId: 'g1',
    service: 'PODIUM',
    quantity: 1,
    rate: 500,
    quotedTotal: 500,
    advanceAmount: 0,
    status: 'paid'
  });

  // Deal g1 is marked paid
  ctx.data.receipts.push({
    id: 'deal-g1-receipt',
    clientId: 'c1',
    clientName: 'TAYARI EVENTS',
    amount: 7000,
    receivedMonth: '2026-10-01',
    receivedOn: '2026-10-26',
    referenceKind: 'deal',
    referenceId: 'g1',
    description: 'RAMLEELA EVENT 2026'
  });

  // Also simulate an orphaned/legacy receipt for PODIUM 500
  ctx.data.receipts.push({
    id: 'ghost-podium-receipt',
    clientId: 'c1',
    clientName: 'TAYARI EVENTS',
    amount: 500,
    receivedMonth: '2026-10-01',
    receivedOn: '2026-10-26',
    referenceKind: 'item',
    referenceId: 'old-podium-id',
    description: 'PODIUM'
  });

  // 1. receiptEffectiveAmount returns 0 for the ghost receipt so Revenue ignores it
  const ghostAmt = vm.runInContext("receiptEffectiveAmount(data.receipts.find(r => r.id === 'ghost-podium-receipt'))", ctx);
  assert.equal(ghostAmt, 0, 'Ghost receipt for PODIUM returns 0 because PODIUM is in deal group g1');

  // 2. consolidateAllReceipts removes the ghost receipt completely
  vm.runInContext("consolidateAllReceipts()", ctx);
  assert.equal(ctx.data.receipts.some(r => r.id === 'ghost-podium-receipt'), false, 'Ghost PODIUM receipt deleted by consolidateAllReceipts');
  assert.ok(ctx.data.pendingDeletes.some(d => d.id === 'ghost-podium-receipt'), 'Queued in pendingDeletes for Supabase removal');

  console.log('✓ Test 5: Redundant or orphaned receipt for an item in a deal group (PODIUM) is ignored and cleaned up');
})();

console.log('\nALL NESTED GROUPS AND REVENUE RECEIPT TESTS PASSED! 🎉');
