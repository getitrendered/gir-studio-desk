const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');

const context = {
  crypto: require('node:crypto'),
  structuredClone: v => JSON.parse(JSON.stringify(v)),
  console,
  setTimeout,
  clearTimeout,
  URL: { createObjectURL: () => '' },
  window: { desk: { write: async () => true, read: async () => null, updates: { onChange: () => {}, state: async () => ({}) } } },
  document: {
    documentElement: { style: { setProperty: () => {} } },
    querySelectorAll: () => [],
    querySelector: () => ({ classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setProperty: () => {}, innerHTML: '', style: {}, addEventListener: () => {} }),
    addEventListener: () => {}
  },
  $: () => ({ classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setProperty: () => {}, innerHTML: '', style: {}, addEventListener: () => {} }),
  $$: () => [],
  requestAnimationFrame: (cb) => cb(),
  data: {
    settings: { zoom: 100, workspaceId: 'ws', seller: {} },
    clients: [{ id: 'c1', name: 'FUNCTION JUNCTION' }],
    groups: [],
    projectGroups: [],
    items: [
      { id: 'fj1', clientId: 'c1', groupId: null, service: 'PDF TO JPG', quantity: 29, rate: 400, quotedTotal: 11600, advanceAmount: 0, status: 'paid', paidAt: '2026-10-22', paidAtTs: '2026-10-22T10:52:34.171Z' }
    ],
    invoices: [],
    receipts: [
      { id: 'r_hist', clientId: 'c_hist', clientName: 'Bling it on', amount: 8820, receivedMonth: '2026-10-01', receivedOn: '2026-10-13', source: 'historical_workbook', description: 'Historical payment' },
      { id: 'r_fj', clientId: 'c1', clientName: 'FUNCTION JUNCTION', amount: 11600, receivedMonth: '2026-10-01', receivedOn: '2026-10-22', source: 'app', sourceKey: 'app:fj1', referenceKind: 'item', referenceId: 'fj1', description: 'PDF TO JPG' }
    ],
    pending: [],
    pendingDeletes: [],
    members: []
  },
  selected: new Set(),
  num: v => Number(v) || 0,
  money: v => 'Rs.' + v,
  esc: s => String(s || ''),
  fmtDate: s => s,
  today: () => '2026-10-22',
  currentUserId: () => 'user-me',
  uid: (() => { let n = 0; return () => 'uid-' + (++n); })(),
  enqueue: (table, id) => { context.data.pending.push({ table, id }); },
  queue: (table, id) => { context.enqueue(table, id); },
  save: () => {},
  scheduleSync: () => {},
  render: () => {},
  toast: () => {},
  closeStatusMenu: () => {},
  closeModal: () => {},
  tab: 'revenue',
  lastRenderedTab: 'sheet',
  activeClient: 'c1',
  invoiceAdvance: () => 0
};

vm.createContext(context);
vm.runInContext(source, context);

// Populate test data after app.js initialized defaults
vm.runInContext(`
data.clients = [{ id: 'c1', name: 'FUNCTION JUNCTION' }];
data.items = [
  { id: 'fj1', clientId: 'c1', groupId: null, service: 'PDF TO JPG', quantity: 29, rate: 400, quotedTotal: 11600, advanceAmount: 0, status: 'paid', paidAt: '2026-10-22', paidAtTs: '2026-10-22T10:52:34.171Z' }
];
data.receipts = [
  { id: 'r_hist', clientId: 'c_hist', clientName: 'Bling it on', amount: 8820, receivedMonth: '2026-10-01', receivedOn: '2026-10-13', source: 'historical_workbook', description: 'Historical payment' },
  { id: 'r_fj', clientId: 'c1', clientName: 'FUNCTION JUNCTION', amount: 11600, receivedMonth: '2026-10-01', receivedOn: '2026-10-22', source: 'app', sourceKey: 'app:fj1', referenceKind: 'item', referenceId: 'fj1', description: 'PDF TO JPG' }
];
activeClient = 'c1';
`, context);

// 1. Initial financials: 8820 + 11600 = 20420
let f = vm.runInContext('financials()', context);
assert.equal(f.revenue, 20420, 'Initial revenue');

// 2. Edit cell: Function Junction changed from 11600 to 11420
vm.runInContext("editCell('fj1', 'quotedTotal', 11420)", context);
f = vm.runInContext('financials()', context);
assert.equal(f.revenue, 20240, 'Revenue dynamically updated to 20240');
assert.equal(vm.runInContext("data.receipts.find(r => r.id === 'r_fj').amount", context), 11420, 'Receipt amount updated in store');

// 3. Edit service name: Function Junction service changed
vm.runInContext("editCell('fj1', 'service', 'PDF TO JPG (29 pages)')", context);
assert.equal(vm.runInContext("data.receipts.find(r => r.id === 'r_fj').description", context), 'PDF TO JPG (29 pages)', 'Receipt description updated');

// 4. Test renderRevenue output contains updated amount and description
const html = vm.runInContext('renderRevenue()', context);
assert.ok(html.includes('20,240') || html.includes('20240'), 'Rendered revenue has 20240');
assert.ok(html.includes('PDF TO JPG (29 pages)'), 'Rendered revenue has new service name');

// 5. Unmark paid: change status to 'sent'
vm.runInContext("bulkSetStatus('sent', ['fj1'])", context);
f = vm.runInContext('financials()', context);
assert.equal(f.revenue, 8820, 'Revenue dropped back to historical 8820 when item unmarked from paid');
assert.equal(vm.runInContext("data.receipts.some(r => r.id === 'r_fj')", context), false, 'Receipt removed from receipts list');
assert.ok(vm.runInContext("data.pendingDeletes.some(d => d.table === 'receipts' && d.id === 'r_fj')", context), 'Pending delete recorded');

// 6. Mark paid again: status changed back to 'paid'
vm.runInContext("bulkSetStatus('paid', ['fj1'])", context);
f = vm.runInContext('financials()', context);
assert.equal(f.revenue, 20240, 'Revenue restored to 20240 when marked paid again');
const newReceipt = vm.runInContext("data.receipts.find(r => r.referenceId === 'fj1')", context);
assert.ok(newReceipt, 'New receipt created');
assert.equal(newReceipt.amount, 11420, 'New receipt has 11420');

console.log('ALL DYNAMIC SYNC AND REVENUE TESTS PASSED!');
