const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const backBtnMock = { disabled: true };
const context = {
  crypto: require('node:crypto'),
  structuredClone: v => JSON.parse(JSON.stringify(v)),
  console,
  setTimeout,
  clearTimeout,
  setInterval: () => {},
  clearInterval: () => {},
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  window: {
    desk: {
      write: async () => true,
      read: async () => null,
      updates: { onChange: () => {}, state: async () => ({}) }
    }
  },
  document: {
    documentElement: { style: { setProperty: () => {} } },
    querySelectorAll: () => [],
    querySelector: (sel) => {
      if (sel === '#topBackBtn') return backBtnMock;
      return { classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setProperty: () => {}, innerHTML: '', style: {}, addEventListener: () => {} };
    },
    addEventListener: () => {}
  },
  $: (sel) => {
    if (sel === '#topBackBtn') return backBtnMock;
    return { classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setProperty: () => {}, innerHTML: '', style: {}, addEventListener: () => {} };
  },
  $$: () => [],
  requestAnimationFrame: cb => cb(),
  toast: () => {},
  closeModal: () => {},
  modal: () => {},
  save: () => {},
  render: () => {},
  mutate: () => {},
  clientItems: () => [],
  billedIds: () => new Set(),
  invoiceAdvance: () => 0
};

vm.createContext(context);
vm.runInContext(source, context);

// Test 1: Navigation history & Back button
vm.runInContext(`
tab = 'sheet';
activeClient = 'c1';
recordNav('sheet', 'c1');
`, context);

assert.equal(vm.runInContext('navHistory.length', context), 1, 'navHistory should have 1 item');
assert.equal(backBtnMock.disabled, false, 'Back button should be enabled');

// Simulate going back
vm.runInContext(`
tab = 'tracker';
goBack();
`, context);

assert.equal(vm.runInContext('tab', context), 'sheet', 'Tab should be restored to sheet');
assert.equal(vm.runInContext('navHistory.length', context), 0, 'navHistory should be empty after popping');
assert.equal(backBtnMock.disabled, true, 'Back button should be disabled when history is empty');
console.log('✓ Test 1: Navigation history & Back button passed');

// Test 2: Unassigned work in Work Tracker excludes 'sent' and only shows pending/changes
vm.runInContext(`
data.clients = [
  { id: 'c_purple', name: 'PURPLE TREE' },
  { id: 'c_tayari', name: 'TAYARI EVENTS' }
];
data.items = [
  { id: 'i1', clientId: 'c_purple', service: 'BAR FLOWER', quantity: 1, rate: 400, quotedTotal: 400, status: 'sent', assigneeId: null },
  { id: 'i2', clientId: 'c_purple', service: 'SANGEET BUFFET', quantity: 1, rate: 400, quotedTotal: 400, status: 'pending', assigneeId: null },
  { id: 'i3', clientId: 'c_tayari', service: 'TICKET COUNTER', quantity: 1, rate: 500, quotedTotal: 500, status: 'pending', assigneeId: null },
  { id: 'i4', clientId: 'c_tayari', service: 'LOGO', quantity: 1, rate: 1000, quotedTotal: 1000, status: 'sent', assigneeId: null },
  { id: 'i5', clientId: 'c_tayari', service: 'PAID ITEM', quantity: 1, rate: 800, quotedTotal: 800, status: 'paid', assigneeId: null },
  { id: 'i6', clientId: 'c_tayari', service: 'ASSIGNED ITEM', quantity: 1, rate: 1500, quotedTotal: 1500, status: 'pending', assigneeId: 'local-me' }
];
`, context);

const trackerHtml = vm.runInContext('renderTracker()', context);

// 'sent' items should NOT be in unassigned section
assert.ok(!trackerHtml.includes('BAR FLOWER'), 'Sent item BAR FLOWER should NOT be in unassigned tracker');
assert.ok(!trackerHtml.includes('PAID ITEM'), 'Paid item should NOT be in unassigned tracker');

// The default open client card shows its pending items
assert.ok(trackerHtml.includes('SANGEET BUFFET'), 'Pending unassigned item should be shown in open client card');

// Both client name cards are displayed
assert.ok(trackerHtml.includes('tracker-client-card'), 'Client name cards rendered');
assert.ok(trackerHtml.includes('PURPLE TREE'), 'Client name PURPLE TREE displayed');
assert.ok(trackerHtml.includes('TAYARI EVENTS'), 'Client name TAYARI EVENTS displayed');
assert.ok(trackerHtml.includes('data-toggle-tracker-client'), 'Toggle client card attribute present');

// When expanding second client card, its pending items show
vm.runInContext("openTrackerClients.add('c_tayari')", context);
const expandedHtml = vm.runInContext('renderTracker()', context);
assert.ok(expandedHtml.includes('TICKET COUNTER'), 'Pending unassigned item in expanded card should be shown');
console.log('✓ Test 2: Unassigned tracker filter passed (sent items excluded)');
console.log('✓ Test 3: Unassigned client name grouping & expansion passed');

// Test 4: "▶ Start work" button label
assert.ok(trackerHtml.includes('▶ Start work'), 'Button label is ▶ Start work');
assert.ok(!trackerHtml.includes('▶ Start<'), 'Old ▶ Start button label is replaced');
console.log('✓ Test 4: ▶ Start work button label passed');

// Test 5: Verify new logo assets
const iconPng = path.join(__dirname, '..', 'assets', 'gir-icon.png');
const iconIco = path.join(__dirname, '..', 'assets', 'gir-icon.ico');
assert.ok(fs.existsSync(iconPng), 'gir-icon.png exists');
assert.ok(fs.statSync(iconPng).size > 10000, 'gir-icon.png has content');
assert.ok(fs.existsSync(iconIco), 'gir-icon.ico exists');
assert.ok(fs.statSync(iconIco).size > 10000, 'gir-icon.ico has content');
console.log('✓ Test 5: App logo assets verified');

console.log('ALL WORK TRACKER & NAVIGATION TESTS PASSED!');
