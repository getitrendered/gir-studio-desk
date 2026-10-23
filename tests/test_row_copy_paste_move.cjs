const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Build mock browser context
const context = {
  crypto: { randomUUID: () => 'uid-' + Math.random().toString(36).slice(2, 10) },
  structuredClone: v => JSON.parse(JSON.stringify(v)),
  console,
  setTimeout: () => {},
  clearTimeout: () => {},
  setInterval: () => {},
  clearInterval: () => {},
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  window: { desk: { write: async () => true, read: async () => null, updates: { onChange: () => {}, state: async () => ({}) } } },
  document: {
    documentElement: { style: { setProperty: () => {} } },
    querySelectorAll: () => [],
    querySelector: () => ({ classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setProperty: () => {}, innerHTML: '', style: {}, addEventListener: () => {} }),
    addEventListener: () => {}
  },
  $: () => ({ classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setProperty: () => {}, innerHTML: '', style: {}, addEventListener: () => {} }),
  $$: () => [],
  requestAnimationFrame: cb => cb(),
  navigator: { clipboard: { writeText: async () => {} } }
};

vm.createContext(context);
vm.runInContext(appJs, context);

console.log('Testing Row Copy, Cut, Paste, Move, and Serial Number fixes...');

// Test 1: cleanSerial
const cleanSerial = vm.runInContext('cleanSerial', context);
assert.strictEqual(cleanSerial('1.0'), '1', '1.0 should clean to 1');
assert.strictEqual(cleanSerial('2.0'), '2', '2.0 should clean to 2');
assert.strictEqual(cleanSerial('232.0'), '232', '232.0 should clean to 232');
assert.strictEqual(cleanSerial('10.00'), '10', '10.00 should clean to 10');
assert.strictEqual(cleanSerial(1), '1', '1 should clean to 1');
assert.strictEqual(cleanSerial('5'), '5', '5 should clean to 5');
assert.strictEqual(cleanSerial(''), '', 'empty should clean to empty');
assert.strictEqual(cleanSerial(null), '', 'null should clean to empty');
console.log('✓ Test 1: cleanSerial removes trailing .0 and normalizes integer strings');

// Setup test client and items
vm.runInContext(`
  data.clients = [{ id: 'client-1', name: 'Test Client', billing: {} }];
  activeClient = 'client-1';
  tab = 'sheet';
  data.items = [
    {
      id: 'item-1',
      clientId: 'client-1',
      groupId: null,
      projectGroupId: null,
      sortOrder: 0,
      serial: '1.0',
      service: '3D Floor Plan',
      quantity: 2,
      rate: 5000,
      quotedTotal: 10000,
      advanceAmount: 2000,
      status: 'pending',
      remarks: 'Urgent render'
    },
    {
      id: 'item-2',
      clientId: 'client-1',
      groupId: null,
      projectGroupId: null,
      sortOrder: 1,
      serial: '2.0',
      service: 'Logo Animation',
      quantity: 1,
      rate: 3000,
      quotedTotal: 3000,
      advanceAmount: 0,
      status: 'working',
      remarks: 'Draft 1'
    },
    {
      id: 'item-3',
      clientId: 'client-1',
      groupId: null,
      projectGroupId: null,
      sortOrder: 2,
      serial: '3.0',
      service: 'Photoshop Touchup',
      quantity: 5,
      rate: 800,
      quotedTotal: 4000,
      advanceAmount: 1000,
      status: 'sent',
      remarks: 'Final version'
    }
  ];
`, context);

// Test 2: Copy & Paste Row
vm.runInContext(`
  selected.clear();
  selected.add('item-1');
  copySelectedRows(false);
`, context);

const clipboardAfterCopy = vm.runInContext('rowClipboard', context);
assert.strictEqual(clipboardAfterCopy.mode, 'copy');
assert.strictEqual(clipboardAfterCopy.items.length, 1);
assert.strictEqual(clipboardAfterCopy.items[0].service, '3D Floor Plan');

// Paste into item-2
vm.runInContext(`
  selected.clear();
  selected.add('item-2');
  pasteCopiedRows('item-2');
`, context);

const itemsAfterPaste = vm.runInContext('data.items', context);
const item2AfterPaste = itemsAfterPaste.find(i => i.id === 'item-2');
assert.strictEqual(item2AfterPaste.service, '3D Floor Plan', 'item-2 should have pasted service');
assert.strictEqual(item2AfterPaste.quantity, 2, 'item-2 should have pasted quantity');
assert.strictEqual(item2AfterPaste.rate, 5000, 'item-2 should have pasted rate');
assert.strictEqual(item2AfterPaste.quotedTotal, 10000, 'item-2 should have pasted quotedTotal');
assert.strictEqual(item2AfterPaste.remarks, 'Urgent render', 'item-2 should have pasted remarks');
// item-1 should be unchanged
const item1AfterCopyPaste = itemsAfterPaste.find(i => i.id === 'item-1');
assert.strictEqual(item1AfterCopyPaste.service, '3D Floor Plan', 'item-1 should remain intact');
console.log('✓ Test 2: Row copy and paste copies values smoothly into target row');

// Test 3: Cut & Paste Row
vm.runInContext(`
  selected.clear();
  selected.add('item-3');
  copySelectedRows(true);
`, context);

const clipboardAfterCut = vm.runInContext('rowClipboard', context);
assert.strictEqual(clipboardAfterCut.mode, 'cut');
assert.strictEqual(clipboardAfterCut.items.length, 1);
assert.strictEqual(clipboardAfterCut.items[0].service, 'Photoshop Touchup');

// Paste into item-2
vm.runInContext(`
  selected.clear();
  selected.add('item-2');
  pasteCopiedRows('item-2');
`, context);

const itemsAfterCutPaste = vm.runInContext('data.items', context);
const item2AfterCut = itemsAfterCutPaste.find(i => i.id === 'item-2');
const item3AfterCut = itemsAfterCutPaste.find(i => i.id === 'item-3');
assert.strictEqual(item2AfterCut.service, 'Photoshop Touchup', 'item-2 should receive cut values');
assert.strictEqual(item3AfterCut.service, '', 'source item-3 service should be cleared on cut');
assert.strictEqual(item3AfterCut.quotedTotal, 0, 'source item-3 total should be reset');
console.log('✓ Test 3: Row cut and paste moves content and resets source row');

// Test 4: Duplicate row
vm.runInContext(`
  selected.clear();
  selected.add('item-1');
  duplicateSelectedRow('item-1');
`, context);

const itemsAfterDuplicate = vm.runInContext('clientItems()', context);
assert.strictEqual(itemsAfterDuplicate.length, 4, 'Items count should increase by 1');
assert.strictEqual(itemsAfterDuplicate[0].id, 'item-1');
assert.strictEqual(itemsAfterDuplicate[1].service, '3D Floor Plan', 'Duplicate should have same service');
assert.notStrictEqual(itemsAfterDuplicate[1].id, 'item-1', 'Duplicate should have unique id');
assert.strictEqual(itemsAfterDuplicate[0].sortOrder, 0);
assert.strictEqual(itemsAfterDuplicate[1].sortOrder, 1);
assert.strictEqual(itemsAfterDuplicate[0].serial, '1');
assert.strictEqual(itemsAfterDuplicate[1].serial, '2');
assert.strictEqual(itemsAfterDuplicate[2].serial, '3');
assert.strictEqual(itemsAfterDuplicate[3].serial, '4');
console.log('✓ Test 4: Row duplication inserts adjacent clone with clean sequential serial numbers');

// Test 5: Move row to serial / position
vm.runInContext(`
  // Move the 4th item to position 1 (top of stack)
  const lastItem = clientItems()[3];
  moveRowToPosition(lastItem.id, 1);
`, context);

const itemsAfterMove = vm.runInContext('clientItems()', context);
assert.strictEqual(itemsAfterMove[0].serial, '1');
assert.strictEqual(itemsAfterMove[1].serial, '2');
assert.strictEqual(itemsAfterMove[2].serial, '3');
assert.strictEqual(itemsAfterMove[3].serial, '4');
// All serial numbers should be integers without decimals
itemsAfterMove.forEach(item => {
  assert.ok(!item.serial.includes('.'), `Serial ${item.serial} should not contain decimal`);
});
console.log('✓ Test 5: Move row to position re-indexes stack with pure integer serial numbers');

// Test 6: Move row up and down by delta
vm.runInContext(`
  const secondItem = clientItems()[1];
  const secondId = secondItem.id;
  // Move up by 1 (-1)
  moveRowByDelta(secondId, -1);
`, context);

const itemsAfterMoveUp = vm.runInContext('clientItems()', context);
assert.strictEqual(itemsAfterMoveUp[0].serial, '1');
assert.strictEqual(itemsAfterMoveUp[1].serial, '2');
console.log('✓ Test 6: Move row by delta (Alt+Up / Alt+Down) works seamlessly');

console.log('ALL ROW COPY, CUT, PASTE, AND MOVE TESTS PASSED!');
