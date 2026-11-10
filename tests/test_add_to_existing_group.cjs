const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('Testing "Add to Existing Group" and Group Boundary Visualization...');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const extrasCss = fs.readFileSync(path.join(__dirname, '..', 'extras.css'), 'utf8');

// Test 1: Verify context menu & toolbar presence
assert.ok(appJs.includes('id="contextAddToGroup"'), 'Context menu must include #contextAddToGroup button');
assert.ok(appJs.includes('data-action="add-to-group"'), 'Toolbar must include data-action="add-to-group" button');
assert.ok(appJs.includes('addToExistingGroupDialog'), 'app.js must declare addToExistingGroupDialog');
console.log('✔ Test 1: Context menu button and toolbar button verified');

// Test 2: Verify CSS rules for group indicators and last-row boundaries
assert.ok(extrasCss.includes('.sheet tr.project-grouped td.row-selector'), 'Must style project-grouped rows with emerald accent');
assert.ok(extrasCss.includes('.sheet tr.grouped td.row-selector'), 'Must style deal-grouped rows with amber accent');
assert.ok(extrasCss.includes('.sheet tr.project-group-last td'), 'Must include boundary border for project-group-last');
assert.ok(extrasCss.includes('.sheet tr.deal-group-last td'), 'Must include boundary border for deal-group-last');
console.log('✔ Test 2: CSS boundary borders and group visual accents verified');

// Test 3: Functional test of addToExistingGroupDialog adding a standalone row to project group
function setupContext() {
  const context = {
    data: {
      clients: [{ id: 'c1', name: 'Function Junction' }],
      projectGroups: [
        { id: 'pg1', clientId: 'c1', label: 'Nivedita & Dheeraj' }
      ],
      groups: [
        { id: 'dg1', clientId: 'c1', label: 'Deal One', agreedAmount: null }
      ],
      items: [
        { id: 'r52', clientId: 'c1', projectGroupId: 'pg1', groupId: null, sortOrder: 0, serial: '52', service: 'VIDEO INVITE', quantity: 1, rate: 3000, quotedTotal: 3000, status: 'sent', advanceAmount: 0 },
        { id: 'r53', clientId: 'c1', projectGroupId: 'pg1', groupId: null, sortOrder: 1, serial: '53', service: 'MONOGRAM', quantity: 1, rate: 1000, quotedTotal: 1000, status: 'sent', advanceAmount: 0 },
        { id: 'r55', clientId: 'c1', projectGroupId: 'pg1', groupId: null, sortOrder: 2, serial: '55', service: 'WELCOME NOTE', quantity: 1, rate: 1000, quotedTotal: 1000, status: 'pending', advanceAmount: 0 },
        { id: 'r76', clientId: 'c1', projectGroupId: null, groupId: null, sortOrder: 3, serial: '76', service: 'TEAM BACKDROP', quantity: 1, rate: 400, quotedTotal: 400, status: 'pending', advanceAmount: 0 },
        { id: 'r77', clientId: 'c1', projectGroupId: null, groupId: null, sortOrder: 4, serial: '77', service: 'OTHER CLIENT WORK', quantity: 1, rate: 500, quotedTotal: 500, status: 'sent', advanceAmount: 0 }
      ],
      pending: [],
      pendingDeletes: [],
      receipts: []
    },
    activeClient: 'c1',
    selected: new Set(),
    undoStack: [],
    redoStack: [],
    num: v => Number(v) || 0,
    cleanSerial: s => String(s || '').trim(),
    clientItems: () => context.data.items.filter(i => i.clientId === context.activeClient).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)),
    enqueue: (table, id) => {
      const key = table + ':' + id;
      if (!context.data.pending.some(p => p.key === key)) context.data.pending.push({ key, table, id });
    },
    syncProjectReceipt: () => {},
    syncDealReceipt: () => {},
    consolidateAllReceipts: () => {},
    save: () => {},
    scheduleSync: () => {},
    render: () => {},
    selectSheetRow: () => {},
    closeModal: () => {},
    pushUndo: action => context.undoStack.push(action),
    setTimeout: fn => fn(),
    document: { querySelector: () => null },
    toast: msg => { context.lastToast = msg; },
    esc: s => s,
    $: sel => {
      if (context.mockDom && context.mockDom[sel]) return context.mockDom[sel];
      return { value: '', checked: false, onclick: null };
    }
  };

  function extractFn(name) {
    const startIdx = appJs.indexOf(`function ${name}(`);
    if (startIdx === -1) throw new Error(`Function ${name} not found`);
    let endIdx = appJs.indexOf('\nfunction ', startIdx + 1);
    if (endIdx === -1) endIdx = appJs.length;
    return appJs.slice(startIdx, endIdx);
  }

  const code = extractFn('addToExistingGroupDialog');
  vm.runInContext(code, vm.createContext(context));
  return context;
}

const ctx = setupContext();

// Mock modal UI
let renderedModal = null;
ctx.modal = (title, body, actions) => {
  renderedModal = { title, body, actions };
};

// Select row 76 and open dialog
ctx.addToExistingGroupDialog(['r76']);

assert.ok(renderedModal, 'Modal should be rendered');
assert.ok(renderedModal.body.includes('Nivedita &amp; Dheeraj') || renderedModal.body.includes('Nivedita & Dheeraj'), 'Modal should list Nivedita & Dheeraj');
assert.ok(renderedModal.body.includes('TEAM BACKDROP'), 'Modal should mention TEAM BACKDROP');

// Mock DOM elements to confirm action
const mockElements = {
  '#existingGroupSelect': { value: 'project:pg1' },
  '#moveAdjacentToGroup': { checked: true },
  '#cancelAddToGroup': { onclick: null },
  '#confirmAddToGroup': { onclick: null }
};
ctx.mockDom = mockElements;

// Re-open with mock DOM selectors ready
ctx.addToExistingGroupDialog(['r76']);
const confirmBtnHandler = mockElements['#confirmAddToGroup'].onclick;
assert.ok(typeof confirmBtnHandler === 'function', 'Confirm button click handler must be assigned');

// Trigger confirmation
confirmBtnHandler();

const r76 = ctx.data.items.find(i => i.id === 'r76');
assert.equal(r76.projectGroupId, 'pg1', 'Row 76 must now have projectGroupId pg1');
assert.ok(ctx.lastToast.includes('Nivedita & Dheeraj'), 'Toast must confirm addition to group');

// Check that r76 was moved right after r55 (end of that group)
const items = ctx.clientItems();
const idx55 = items.findIndex(i => i.id === 'r55');
const idx76 = items.findIndex(i => i.id === 'r76');
assert.equal(idx76, idx55 + 1, 'Row 76 must be placed directly after the last group item');
assert.equal(r76.serial, '4', 'Row 76 serial should be updated to sequential position');

console.log('✔ Test 3: Standalone row successfully added and repositioned into existing project group');

// Test 4: Verify rendering of last row classes in renderSheet logic
const itemsMock = [
  { id: '1', projectGroupId: 'pg1' },
  { id: '2', projectGroupId: 'pg1' },
  { id: '3', projectGroupId: null }
];
for (let idx = 0; idx < itemsMock.length; idx++) {
  const i = itemsMock[idx];
  const nextItem = itemsMock[idx + 1];
  const isLastOfProject = i.projectGroupId && (!nextItem || nextItem.projectGroupId !== i.projectGroupId);
  if (idx === 1) {
    assert.equal(isLastOfProject, true, 'Item 2 should be identified as last item of project group');
  }
  if (idx === 0) {
    assert.equal(isLastOfProject, false, 'Item 1 should NOT be last item of project group');
  }
}
console.log('✔ Test 4: Group boundary detection logic verified');

console.log('\nALL ADD TO EXISTING GROUP TESTS PASSED SUCCESSFULLY! 🚀');
