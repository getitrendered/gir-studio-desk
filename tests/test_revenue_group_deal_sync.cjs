const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setupEnvironment() {
  const sandbox = {
    console,
    Math,
    Number,
    Date,
    Array,
    Set,
    Map,
    today: () => '2026-11-21',
    uid: () => 'uid_' + Math.random().toString(36).slice(2, 9),
    cleanSerial: s => s,
    num: v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0,
    money: n => '₹' + Number(n).toLocaleString('en-IN'),
    esc: s => s,
    toast: () => {},
    closeModal: () => {},
    render: () => {},
    save: () => { sandbox.saveCalls = (sandbox.saveCalls || 0) + 1; },
    scheduleSync: () => { sandbox.syncCalls = (sandbox.syncCalls || 0) + 1; },
    enqueue: (table, id) => {
      sandbox.data.pending = sandbox.data.pending || [];
      sandbox.data.pending.push({ table, id });
    },
    removeReceipt: id => {
      sandbox.data.receipts = (sandbox.data.receipts || []).filter(r => r.id !== id);
    },
    data: {
      clients: [{ id: 'c1', name: 'Nivedita & Dheeraj' }],
      groups: [],
      projectGroups: [],
      items: [],
      invoices: [],
      receipts: [],
      rentals: [],
      pending: [],
      members: [],
      settings: {}
    }
  };

  vm.createContext(sandbox);

  // Extract necessary helper functions and modules from app.js
  const helperFns = [
    'function billedIds(',
    'function invoiceAdvance(',
    'function receiptEffectiveItem(',
    'function receiptEffectiveAmount(',
    'function receiptEffectiveDescription(',
    'function receiptEffectiveClientName(',
    'function financials(',
    'function effectiveItemValue(',
    'function createReceipt(',
    'function syncDealReceipt(',
    'function syncProjectReceipt(',
    'function healInvoicedItemStatuses(',
    'function syncGroupInvoicesAndReceipts(',
    'function healGroupRevenueSync(',
    'function groupTotalValue('
  ];

  for (const fnSig of helperFns) {
    const fnStart = appSource.indexOf(fnSig);
    if (fnStart === -1) {
      throw new Error(`Could not find signature: ${fnSig} in app.js`);
    }
    // Find end of function by counting braces
    const openBrace = appSource.indexOf('{', fnStart);
    let depth = 1;
    let pos = openBrace + 1;
    while (depth > 0 && pos < appSource.length) {
      if (appSource[pos] === '{') depth++;
      else if (appSource[pos] === '}') depth--;
      pos++;
    }
    const fnCode = appSource.slice(fnStart, pos);
    vm.runInContext(fnCode, sandbox);
  }

  return sandbox;
}

console.log('Running test_revenue_group_deal_sync.cjs...');

// Test 1: Invoiced group deal where agreed deal was edited
{
  const sb = setupEnvironment();
  const group = { id: 'g1', clientId: 'c1', label: 'Nivedita & Dheeraj', agreedAmount: 17300 };
  sb.data.groups.push(group);

  const item1 = { id: 'i1', groupId: 'g1', clientId: 'c1', service: 'Video Invite', quotedTotal: 10000, advanceAmount: 0, status: 'paid', paidAt: '2026-11-20' };
  const item2 = { id: 'i2', groupId: 'g1', clientId: 'c1', service: 'Stationery', quotedTotal: 7300, advanceAmount: 0, status: 'paid', paidAt: '2026-11-20' };
  sb.data.items.push(item1, item2);

  const inv1 = {
    id: 'inv1',
    clientId: 'c1',
    number: 'GIR-2026-001',
    status: 'paid',
    subtotal: 17300,
    finalAmount: 17300,
    discount: 0,
    itemIds: ['i1', 'i2'],
    lines: [{ serial: 1, description: 'Nivedita & Dheeraj', rate: 17300, total: 17300 }],
    seller: { lumpSum: { isLumpSum: true } }
  };
  sb.data.invoices.push(inv1);

  const receipt1 = {
    id: 'r1',
    referenceKind: 'invoice',
    referenceId: 'inv1',
    amount: 17300,
    clientId: 'c1',
    receivedMonth: '2026-11-01',
    receivedOn: '2026-11-20',
    source: 'app'
  };
  sb.data.receipts.push(receipt1);

  // Initial check
  let f = vm.runInContext('financials()', sb);
  assert.equal(f.revenue, 17300, 'Initial revenue must be 17300');
  assert.equal(f.closed, 17300, 'Initial closed must be 17300');

  // Now user edits group deal to 17,700
  group.agreedAmount = 17700;
  const changed = vm.runInContext("syncGroupInvoicesAndReceipts('deal', 'g1', 17700, 'Nivedita & Dheeraj')", sb);
  assert.equal(changed, true, 'syncGroupInvoicesAndReceipts should return true');

  // Invoice and receipt amounts must be updated
  assert.equal(inv1.finalAmount, 17700, 'Invoice finalAmount must update to 17700');
  assert.equal(inv1.subtotal, 17700, 'Invoice subtotal must update to 17700');
  assert.equal(inv1.lines[0].rate, 17700, 'Invoice line rate must update to 17700');
  assert.equal(receipt1.amount, 17700, 'Invoice receipt amount must update to 17700');

  // Revenue must now reflect 17,700
  f = vm.runInContext('financials()', sb);
  assert.equal(f.revenue, 17700, 'Financials revenue must now reflect updated deal amount 17700');
  assert.equal(f.closed, 17700, 'Financials closed must now reflect updated deal amount 17700');
  console.log('✓ Test 1: Invoiced group deal sync immediately updates invoice, receipt, and Revenue to 17,700');
}

// Test 2: Auto-healing on startup or Revenue tab open (healGroupRevenueSync)
{
  const sb = setupEnvironment();
  // Group was already edited to 17700, but invoice & receipt were stuck at 17300 from prior version
  const group = { id: 'g1', clientId: 'c1', label: 'Nivedita & Dheeraj', agreedAmount: 17700 };
  sb.data.groups.push(group);

  const item1 = { id: 'i1', groupId: 'g1', clientId: 'c1', service: 'Video', quotedTotal: 10000, advanceAmount: 0, status: 'paid', paidAt: '2026-11-20' };
  const item2 = { id: 'i2', groupId: 'g1', clientId: 'c1', service: 'Signage', quotedTotal: 7300, advanceAmount: 0, status: 'paid', paidAt: '2026-11-20' };
  sb.data.items.push(item1, item2);

  const inv1 = {
    id: 'inv1',
    clientId: 'c1',
    number: 'GIR-2026-001',
    status: 'paid',
    subtotal: 17300,
    finalAmount: 17300,
    discount: 0,
    itemIds: ['i1', 'i2'],
    lines: [{ serial: 1, description: 'Nivedita & Dheeraj', rate: 17300, total: 17300 }]
  };
  sb.data.invoices.push(inv1);

  const receipt1 = {
    id: 'r1',
    referenceKind: 'invoice',
    referenceId: 'inv1',
    amount: 17300,
    clientId: 'c1',
    receivedMonth: '2026-11-01',
    receivedOn: '2026-11-20'
  };
  sb.data.receipts.push(receipt1);

  // Run healGroupRevenueSync
  const healed = vm.runInContext('healGroupRevenueSync()', sb);
  assert.equal(healed, true, 'healGroupRevenueSync must detect and repair mismatch');
  assert.equal(inv1.finalAmount, 17700, 'Healed invoice finalAmount must be 17700');
  assert.equal(receipt1.amount, 17700, 'Healed receipt amount must be 17700');

  const f = vm.runInContext('financials()', sb);
  assert.equal(f.revenue, 17700, 'Revenue reflects healed receipt amount');
  assert.equal(f.closed, 17700, 'Paid work value reflects healed invoice amount');
  console.log('✓ Test 2: healGroupRevenueSync automatically repairs existing mismatched invoices/receipts');
}

// Test 3: Project Group with agreed deal and non-invoiced receipts
{
  const sb = setupEnvironment();
  const projGroup = { id: 'p1', clientId: 'c1', label: 'Grand Project', agreedAmount: 20000 };
  sb.data.projectGroups.push(projGroup);

  const item1 = { id: 'i1', projectGroupId: 'p1', clientId: 'c1', service: 'Design', quotedTotal: 15000, advanceAmount: 2000, status: 'paid', paidAt: '2026-11-20' };
  const item2 = { id: 'i2', projectGroupId: 'p1', clientId: 'c1', service: 'Build', quotedTotal: 15000, advanceAmount: 0, status: 'paid', paidAt: '2026-11-20' };
  sb.data.items.push(item1, item2);

  // Test effectiveItemValue for project group
  const v1 = vm.runInContext('effectiveItemValue(data.items[0])', sb);
  const v2 = vm.runInContext('effectiveItemValue(data.items[1])', sb);
  assert.equal(v1, 10000, 'Item 1 effective value must be half of 20000 = 10000');
  assert.equal(v2, 10000, 'Item 2 effective value must be half of 20000 = 10000');

  // Sync project receipt
  vm.runInContext("syncProjectReceipt('p1')", sb);
  assert.equal(sb.data.receipts.length, 1, 'Project receipt created');
  assert.equal(sb.data.receipts[0].amount, 18000, 'Project receipt amount must be agreed (20000) - advances (2000) = 18000');

  // Verify financials
  const f = vm.runInContext('financials()', sb);
  assert.equal(f.revenue, 18000, 'Revenue reflects project deal receipt amount');
  assert.equal(f.closed, 20000, 'Closed value reflects agreed project deal amount');

  // Now user edits the project deal from 20000 to 22000
  projGroup.agreedAmount = 22000;
  vm.runInContext("syncProjectReceipt('p1')", sb);
  assert.equal(sb.data.receipts[0].amount, 20000, 'Receipt amount updates to 22000 - 2000 = 20000');

  const fUpdated = vm.runInContext('financials()', sb);
  assert.equal(fUpdated.revenue, 20000, 'Revenue reflects updated 22000 deal');
  assert.equal(fUpdated.closed, 22000, 'Closed reflects updated 22000 deal');
  console.log('✓ Test 3: Project groups with agreed deals correctly compute effective values, receipts, and revenue');
}

// Test 4: Group total value display for project groups and deal groups with agreed deals
{
  const sb = setupEnvironment();
  const pg = { id: 'p1', label: 'Wedding Event', agreedAmount: 25000 };
  const items = [
    { id: 'i1', projectGroupId: 'p1', quotedTotal: 15000, status: 'paid' },
    { id: 'i2', projectGroupId: 'p1', quotedTotal: 15000, status: 'paid' }
  ];
  const gVal = vm.runInContext("groupTotalValue('project', data.projectGroups[0] || { id: 'p1', agreedAmount: 25000 }, [{ id: 'i1', status: 'paid', quotedTotal: 15000 }, { id: 'i2', status: 'paid', quotedTotal: 15000 }])", sb);
  assert.equal(gVal.agreed, true, 'gVal.agreed must be true when agreedAmount is present');
  assert.equal(gVal.total, 25000, 'gVal.total must match agreedAmount');
  assert.equal(gVal.paid, 25000, 'gVal.paid must be 25000 when all rows are paid');
  console.log('✓ Test 4: groupTotalValue returns agreed=true and agreed total for project groups with deals');
}

console.log('All tests in test_revenue_group_deal_sync.cjs passed successfully!');
