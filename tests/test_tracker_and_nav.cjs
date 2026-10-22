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

// Test 2: Client grouping and dropdown expand/collapse in Work Tracker
vm.runInContext(`
trackerClientsInitialized = false;
openTrackerClients.clear();
trackerClientFilter = 'active';
trackerClientSearch = '';
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

// Both active client cards are displayed (neither is omitted!)
assert.ok(trackerHtml.includes('tracker-client-card'), 'Client name cards rendered');
assert.ok(trackerHtml.includes('PURPLE TREE'), 'Client name PURPLE TREE displayed');
assert.ok(trackerHtml.includes('TAYARI EVENTS'), 'Client name TAYARI EVENTS displayed');
assert.ok(trackerHtml.includes('data-toggle-tracker-client'), 'Toggle client card attribute present');

// Paid items are excluded from active cards
assert.ok(!trackerHtml.includes('PAID ITEM'), 'Paid item should NOT be in active tracker cards');

// TAYARI EVENTS has 2 pending items (i3, i6), PURPLE TREE has 1 (i2).
// TAYARI EVENTS is sorted first and auto-opened on initial view.
assert.ok(trackerHtml.includes('TICKET COUNTER'), 'First client pending item shown in open card');

// Test 3: Dropdown collapse bugfix verification:
// When the user collapses the only open card, it MUST STAY CLOSED and not auto-reopen!
vm.runInContext("openTrackerClients.clear();", context);
const collapsedHtml = vm.runInContext('renderTracker()', context);
assert.ok(!collapsedHtml.includes('TICKET COUNTER'), 'Item in collapsed card must not be rendered');
assert.ok(!collapsedHtml.includes('tracker-client-card open'), 'No cards should have open class when collapsed');
console.log('✓ Test 2: Client cards rendered for all active clients');
console.log('✓ Test 3: Accordion dropdown collapses and stays closed without auto-reopening');

// Test 4: Expanding a specific client card shows its pending and sent sections
vm.runInContext("openTrackerClients.add('c_purple');", context);
const purpleHtml = vm.runInContext('renderTracker()', context);
assert.ok(purpleHtml.includes('SANGEET BUFFET'), 'Pending item SANGEET BUFFET shown when PURPLE TREE expanded');
assert.ok(purpleHtml.includes('BAR FLOWER'), 'Sent item BAR FLOWER shown under sent section in PURPLE TREE');
console.log('✓ Test 4: Client card expands with pending and sent sections');

// Test 5: "▶ Start work" button label
assert.ok(trackerHtml.includes('▶ Start work'), 'Button label is ▶ Start work');
assert.ok(!trackerHtml.includes('▶ Start<'), 'Old ▶ Start button label is replaced');
console.log('✓ Test 5: ▶ Start work button label passed');

// Test 6: Verify new logo assets
const iconPng = path.join(__dirname, '..', 'assets', 'gir-icon.png');
const iconIco = path.join(__dirname, '..', 'assets', 'gir-icon.ico');
assert.ok(fs.existsSync(iconPng), 'gir-icon.png exists');
assert.ok(fs.statSync(iconPng).size > 10000, 'gir-icon.png has content');
assert.ok(fs.existsSync(iconIco), 'gir-icon.ico exists');
assert.ok(fs.statSync(iconIco).size > 10000, 'gir-icon.ico has content');
console.log('✓ Test 6: App logo assets verified');

// Test 7: Verify tracker status triggers and distinct status colors
assert.ok(trackerHtml.includes('tracker-status-trigger'), 'Tracker renders custom tracker-status-trigger');
assert.ok(trackerHtml.includes('data-status-menu="i3"'), 'Status trigger binds data-status-menu for row i3');
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'extras.css'), 'utf8');
assert.ok(cssContent.includes('.status-option.pending{background:#f1f4f2;color:#4c5e53}'), 'Pending has distinct grey color');
assert.ok(cssContent.includes('.status-option.working{background:#eaf2ff;color:#1853db}'), 'Working has distinct blue color');
assert.ok(cssContent.includes('.status-option.changes{background:#f5eaff;color:#7b1fa2}'), 'Changes has distinct purple color');
assert.ok(cssContent.includes('.status-option.sent{background:#fff3e0;color:#c05600}'), 'Sent has distinct orange color');
assert.ok(cssContent.includes('.status-option.paid{background:#e8f7ec;color:#0d7340}'), 'Paid has distinct green color');
assert.ok(cssContent.includes('.status-option.discarded{background:#fde9e7;color:#c0392b}'), 'Discarded has distinct red color');
console.log('✓ Test 7: Status options have distinct, unique colors per status');

console.log('ALL WORK TRACKER & NAVIGATION TESTS PASSED!');
