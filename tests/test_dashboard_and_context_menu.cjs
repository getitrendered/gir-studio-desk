const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('Testing Dashboard Insights, Toolbar Cleanup, and Context Menu Alignments...');

// 1. Verify extras.css styles
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'extras.css'), 'utf8');

assert.ok(cssContent.includes('.context-menu'), 'extras.css should contain .context-menu');
assert.ok(cssContent.includes('max-height:calc(100vh - 24px)') || cssContent.includes('max-height: calc(100vh - 24px)'), '.context-menu should have max-height calc(100vh - 24px) to prevent bottom cutoff');
assert.ok(cssContent.includes('overflow-y:auto') || cssContent.includes('overflow-y: auto'), '.context-menu should have overflow-y: auto for scrolling');
assert.ok(cssContent.includes('justify-content:flex-start') || cssContent.includes('justify-content: flex-start'), '.context-menu button should have justify-content: flex-start to prevent wide gap between icon and label');
assert.ok(cssContent.includes('gap:8px') || cssContent.includes('gap: 8px'), '.context-menu button should have gap: 8px');
assert.ok(cssContent.includes('margin-left:auto') || cssContent.includes('margin-left: auto'), '.context-menu button kbd should have margin-left: auto to keep shortcut keys on the right');
assert.ok(cssContent.includes('dashboard-insights-container'), 'extras.css should contain dashboard-insights-container');
assert.ok(cssContent.includes('highlight-panel'), 'extras.css should contain highlight-panel');
assert.ok(cssContent.includes('insight-statement-text'), 'extras.css should contain insight-statement-text');

console.log('✓ Test 1: extras.css context-menu alignment, scrollability, and dashboard insights styling verified');

// 2. Setup VM environment to test app.js logic
const appJsSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const mockData = {
  clients: [
    { id: 'c1', name: 'Ashwa Events' },
    { id: 'c2', name: 'Purple Tree' },
    { id: 'c3', name: 'T&F' }
  ],
  groups: [
    { id: 'g1', clientId: 'c1', label: 'BAGA IGNITE', agreedAmount: 70000 }
  ],
  projectGroups: [
    { id: 'p1', clientId: 'c2', label: 'Royal Wedding' }
  ],
  items: [
    // Ashwa Events BAGA IGNITE deal items (all 8 sent, ₹70,000 due)
    ...Array.from({ length: 8 }, (_, idx) => ({
      id: `ashwa-deal-${idx + 1}`,
      clientId: 'c1',
      groupId: 'g1',
      projectGroupId: null,
      service: `Flex Board ${idx + 1}`,
      quantity: 1,
      rate: 8750,
      quotedTotal: 8750,
      advanceAmount: 0,
      status: 'sent'
    })),
    // Ashwa Events 1 standalone pending item
    {
      id: 'ashwa-pending-1',
      clientId: 'c1',
      groupId: null,
      projectGroupId: null,
      service: 'Welcome Signage',
      quantity: 1,
      rate: 5000,
      quotedTotal: 5000,
      advanceAmount: 0,
      status: 'pending'
    },
    // Ashwa Events 1 standalone paid item
    {
      id: 'ashwa-paid-1',
      clientId: 'c1',
      groupId: null,
      projectGroupId: null,
      service: 'Photo Backdrop',
      quantity: 1,
      rate: 10000,
      quotedTotal: 10000,
      advanceAmount: 10000,
      status: 'paid'
    },
    // Purple Tree project items (2 pending, 4 paid)
    { id: 'pt-1', clientId: 'c2', projectGroupId: 'p1', service: 'Stage', quantity: 1, rate: 20000, quotedTotal: 20000, advanceAmount: 0, status: 'pending' },
    { id: 'pt-2', clientId: 'c2', projectGroupId: 'p1', service: 'Audio', quantity: 1, rate: 10000, quotedTotal: 10000, advanceAmount: 0, status: 'working' },
    { id: 'pt-3', clientId: 'c2', projectGroupId: 'p1', service: 'Video', quantity: 1, rate: 15000, quotedTotal: 15000, advanceAmount: 15000, status: 'paid' },
    { id: 'pt-4', clientId: 'c2', projectGroupId: 'p1', service: 'Lights', quantity: 1, rate: 15000, quotedTotal: 15000, advanceAmount: 15000, status: 'paid' }
  ],
  invoices: [],
  receipts: [],
  settings: {
    seller: { name: 'GIR Studio' },
    displayName: 'Samuel',
    workspaceId: 'ws-1'
  }
};

const domElements = new Map();
function createMockElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    style: { setProperty() {} },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [],
    attributes: {},
    innerHTML: '',
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(child) { this.children.push(child); return child; },
    remove() {},
    querySelector(selector) { return createMockElement('div'); },
    querySelectorAll(selector) { return []; },
    addEventListener() {},
    offsetWidth: 235,
    offsetHeight: 420
  };
  return el;
}

const context = {
  structuredClone: globalThis.structuredClone || (x => JSON.parse(JSON.stringify(x))),
  Set,
  Map,
  Date,
  Math,
  Number,
  String,
  Array,
  Boolean,
  setTimeout,
  clearTimeout,
  data: mockData,
  tab: 'sheet',
  filter: 'all',
  activeClient: 'c1',
  selected: new Set(),
  collapsedGroups: new Set(),
  rowClipboard: { items: [], mode: 'copy' },
  undoStack: [],
  redoStack: [],
  blankRows: 40,
  isRowDragSelecting: false,
  justDraggedSelection: false,
  window: {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
    desk: {
      updates: { onChange() {}, checkForUpdates() {}, state: () => Promise.resolve({ status: 'idle' }) }
    }
  },
  document: {
    documentElement: { clientWidth: 1200, clientHeight: 800, style: { setProperty() {} } },
    body: createMockElement('body'),
    createElement: tag => createMockElement(tag),
    querySelector: sel => createMockElement(sel),
    querySelectorAll: sel => [],
    addEventListener: () => {}
  },
  $: sel => createMockElement(sel),
  $$: sel => [],
  num: v => Number(v) || 0,
  money: v => `₹${Number(v).toLocaleString('en-IN')}`,
  esc: s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  uid: () => 'uid-test',
  today: () => '2026-11-01',
  clientItems: cid => mockData.items.filter(i => i.clientId === cid),
  unfinishedCount: cid => mockData.items.filter(i => i.clientId === cid && !['sent', 'paid', 'discarded'].includes(i.status)).length,
  toast: msg => console.log('Toast:', msg),
  console
};

vm.createContext(context);
vm.runInContext(appJsSource, context);
context.mockData = mockData;
vm.runInContext('data = mockData; activeClient = "c1";', context);

// 3. Test selectionLabelHtml
const emptyLabel = vm.runInContext('selectionLabelHtml()', context);
assert.strictEqual(emptyLabel, '', 'Empty selection should return empty string so no empty placeholder clutters the toolbar');

// Select items
vm.runInContext(`
  selected = new Set(['ashwa-pending-1', 'ashwa-deal-1']);
`, context);
const activeLabel = vm.runInContext('selectionLabelHtml()', context);
assert.ok(activeLabel.includes('sel-badge-active'), 'Selected rows should produce sel-badge-active');
assert.ok(activeLabel.includes('TOTAL:'), 'Selected rows should produce TOTAL: label');
assert.ok(!activeLabel.includes('rows selected'), 'Should NOT include "rows selected" to avoid toolbar cropping');
assert.ok(activeLabel.includes('13,750'), 'Total should calculate 5000 + 8750 = 13,750');

console.log('✓ Test 2: selectionLabelHtml returns compact left-docked total without "rows selected" text');

// 4. Test renderSheet() toolbar: Ungroup button removed, selectionCount left-docked
const sheetHtml = vm.runInContext('renderSheet()', context);
assert.ok(!sheetHtml.includes('data-action="ungroup"'), 'Worksheet toolbar should NOT contain data-action="ungroup" button');
assert.ok(sheetHtml.includes('id="selectedCount"'), 'Toolbar should contain #selectedCount');
assert.ok(sheetHtml.includes('class="sheet-toolbar"'), 'Toolbar should contain class="sheet-toolbar"');

console.log('✓ Test 3: renderSheet toolbar does not contain Ungroup button and correctly houses #selectedCount');

// 5. Test positionContextMenu clamping logic
vm.runInContext(`
  const testMenu = document.createElement('div');
  testMenu.offsetWidth = 235;
  testMenu.offsetHeight = 450;
  // Position near right edge (1150) and bottom edge (700) on 1200x800 window
  positionContextMenu(testMenu, 1150, 700);
  globalThis.resultLeft = parseInt(testMenu.style.left);
  globalThis.resultTop = parseInt(testMenu.style.top);
`, context);

assert.ok(context.resultLeft <= 1200 - 235 - 10, 'Context menu left should clamp within right window edge');
assert.ok(context.resultTop <= 800 - 450 - 12, 'Context menu top should clamp within bottom window edge');
console.log('✓ Test 4: positionContextMenu properly clamps within screen bounds to prevent overflow off-screen');

// 6. Test groupHeader includes data-sheet-group attribute
const groupHeaderHtml = vm.runInContext(`
  groupHeader('deal', data.groups[0], data.items.filter(i => i.groupId === 'g1'))
`, context);
assert.ok(groupHeaderHtml.includes('data-sheet-group="deal:g1"'), 'Group header row should carry data-sheet-group="deal:g1" attribute for right-click context menu');
assert.ok(groupHeaderHtml.includes('BAGA IGNITE'), 'Group header should display group label');

console.log('✓ Test 5: renderGroupHeader outputs data-sheet-group attribute for context menu handler');

// 7. Test renderDashboard() completion insights & quick-to-cash wording statements
const dashboardHtml = vm.runInContext('renderDashboard()', context);

assert.ok(dashboardHtml.includes('Clients Closest to Completion'), 'Dashboard should have "Clients Closest to Completion" panel');
assert.ok(dashboardHtml.includes('Ashwa Events'), 'Dashboard should highlight Ashwa Events');
assert.ok(dashboardHtml.includes('Only <strong>1 work</strong> is left') || dashboardHtml.includes('Only 1 work is left'), 'Dashboard should specify "Only 1 work is left" for Ashwa Events');
assert.ok(dashboardHtml.includes('All-Sent Events &amp; Quick Cash') || dashboardHtml.includes('All-Sent Events & Quick Cash'), 'Dashboard should have All-Sent Events & Quick Cash panel');
assert.ok(dashboardHtml.includes('BAGA IGNITE'), 'Dashboard should highlight BAGA IGNITE deal');
assert.ok(dashboardHtml.includes('All 8 works sent! Waiting for confirmation or changes'), 'Dashboard should state all 8 works sent awaiting confirmation or changes');
assert.ok(dashboardHtml.includes('Open sheet →') || dashboardHtml.includes('View in sheet →'), 'Dashboard should provide direct sheet jump buttons');

console.log('✓ Test 6: renderDashboard completion insights and human wording statements verified');

console.log('\nALL DASHBOARD AND CONTEXT MENU TESTS PASSED SUCCESSFULLY!');
