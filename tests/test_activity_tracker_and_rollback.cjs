const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJs = fs.readFileSync(appJsPath, 'utf8');

const mockDocument = {
  body: {
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    appendChild: () => {}
  },
  documentElement: { style: { setProperty: () => {} } },
  querySelectorAll: () => [],
  querySelector: () => ({ classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setProperty: () => {}, innerHTML: '', style: {}, addEventListener: () => {} }),
  addEventListener: () => {}
};

const context = {
  console,
  assert,
  crypto: require('crypto'),
  setTimeout: (cb) => { if (typeof cb === 'function') cb(); },
  clearTimeout: () => {},
  setInterval: () => {},
  clearInterval: () => {},
  Date,
  Math,
  parseInt,
  parseFloat,
  isNaN,
  Array,
  Object,
  String,
  Number,
  Boolean,
  JSON,
  Set,
  Map,
  structuredClone: (obj) => JSON.parse(JSON.stringify(obj)),
  window: {
    desk: {
      read: async () => null,
      write: async () => true,
      updates: { onChange() {}, state: async () => ({ status: 'unavailable' }) }
    },
    addEventListener: () => {}
  },
  document: mockDocument,
  $: () => ({ classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setProperty: () => {}, innerHTML: '', style: {}, addEventListener: () => {} }),
  $$: () => [],
  requestAnimationFrame: cb => cb(),
  navigator: { clipboard: { writeText: async () => {} } }
};

vm.createContext(context);
vm.runInContext(appJs, context);

console.log('Testing Activity Tracker, Rollback, Undo/Redo Buttons & Copy-Paste Blank Row fix...');

// Setup test workspace
vm.runInContext(`
  data.clients = [{ id: 'client-tian', name: 'TIAN', billing: {} }];
  activeClient = 'client-tian';
  tab = 'sheet';
  data.activityLog = [];
  data.items = [
    {
      id: 'item-101',
      clientId: 'client-tian',
      groupId: null,
      projectGroupId: null,
      sortOrder: 0,
      serial: '1',
      service: 'HALDI - CART SIGNAGE',
      quantity: 6,
      rate: 200,
      quotedTotal: 1200,
      advanceAmount: 0,
      status: 'pending',
      remarks: ''
    },
    {
      id: 'item-102',
      clientId: 'client-tian',
      groupId: null,
      projectGroupId: null,
      sortOrder: 1,
      serial: '2',
      service: 'HALDI - CANVAS',
      quantity: 16,
      rate: 200,
      quotedTotal: 3200,
      advanceAmount: 0,
      status: 'pending',
      remarks: ''
    }
  ];
`, context);

// Test 1: Copy-Paste to Blank Row must NOT overwrite existing rows!
vm.runInContext(`
  // 1. Select item-101 and copy it
  selected.clear();
  selected.add('item-101');
  copySelectedRows(false);
  assert.strictEqual(rowClipboard.items.length, 1);
  assert.strictEqual(rowClipboard.items[0].service, 'HALDI - CART SIGNAGE');

  // 2. User clicks a blank row (blankOrder = 2)
  // Simulating blank row click: selected is cleared, selectionCell is set to blankOrder: 2
  selected.clear();
  selectionCell = { blankOrder: 2, key: 'service' };

  // 3. User pastes (Ctrl+V)
  const isBlank = selectionCell?.blankOrder != null;
  const targetId = (!isBlank && selected.size) ? [...selected][0] : null;
  pasteCopiedRows(targetId, selectionCell?.blankOrder);
`, context);

const itemsAfterBlankPaste = vm.runInContext('data.items', context);
assert.strictEqual(itemsAfterBlankPaste.length, 3, 'Should have 3 items after pasting to blank row');
assert.strictEqual(itemsAfterBlankPaste[0].service, 'HALDI - CART SIGNAGE', 'Item 101 must NOT be overwritten');
assert.strictEqual(itemsAfterBlankPaste[1].service, 'HALDI - CANVAS', 'Item 102 must NOT be overwritten');
assert.strictEqual(itemsAfterBlankPaste[2].service, 'HALDI - CART SIGNAGE', 'New Item 3 was created on blank row');
assert.notStrictEqual(itemsAfterBlankPaste[2].id, 'item-101', 'New Item 3 has its own unique ID');
console.log('✓ Test 1: Pasting onto blank row creates a brand new row and NEVER overwrites existing rows');

// Test 2: Verify Activity Tracker logged the paste
const actLogAfterPaste = vm.runInContext('data.activityLog', context);
assert.ok(actLogAfterPaste.length >= 1, 'Activity log should record the paste action');
assert.strictEqual(actLogAfterPaste[0].type, 'paste');
assert.ok(actLogAfterPaste[0].description.includes('Pasted 1 new row'), 'Activity description should note new row pasted');
console.log('✓ Test 2: Paste operation is logged in the Activity Tracker');

// Test 3: Delete row and verify Activity Tracker logging & Rollback
vm.runInContext(`
  selected.clear();
  selected.add('item-102'); // Delete HALDI - CANVAS
  deleteSelectedRows(['item-102']);
`, context);

const itemsAfterDelete = vm.runInContext('data.items', context);
assert.strictEqual(itemsAfterDelete.length, 2, 'Should have 2 items remaining');
assert.ok(!itemsAfterDelete.some(i => i.id === 'item-102'), 'item-102 should be deleted');

const actLogAfterDelete = vm.runInContext('data.activityLog', context);
const deleteActivity = actLogAfterDelete.find(a => a.type === 'delete');
assert.ok(deleteActivity, 'Delete action must be logged in Activity Tracker');
assert.ok(deleteActivity.description.includes('HALDI - CANVAS'), 'Delete action description must name the service');
assert.ok(deleteActivity.items && deleteActivity.items.length === 1, 'Deleted item snapshot must be stored');

// Now Rollback the deletion!
vm.runInContext(`
  rollbackActivity('${deleteActivity.id}');
`, context);

const itemsAfterRollback = vm.runInContext('data.items', context);
assert.strictEqual(itemsAfterRollback.length, 3, 'Deleted item should be restored after rollback');
const restoredItem = itemsAfterRollback.find(i => i.id === 'item-102');
assert.ok(restoredItem, 'item-102 should be fully restored');
assert.strictEqual(restoredItem.service, 'HALDI - CANVAS');
assert.strictEqual(deleteActivity.rolledBack, true, 'Activity should be marked rolledBack = true');
console.log('✓ Test 3: Accidental row deletion is recorded and restored via Rollback in Activity Tracker');

// Test 4: Cell Edit logging & Rollback
vm.runInContext(`
  editCell('item-101', 'rate', 500);
`, context);

const item101Edited = vm.runInContext('data.items.find(i => i.id === "item-101")', context);
assert.strictEqual(item101Edited.rate, 500, 'Rate should be updated to 500');

const actLogAfterEdit = vm.runInContext('data.activityLog', context);
const editActivity = actLogAfterEdit.find(a => a.type === 'update' && a.field === 'rate');
assert.ok(editActivity, 'Rate update should be logged in Activity Tracker');
assert.strictEqual(editActivity.previousValue, 200, 'Previous value should be 200');
assert.strictEqual(editActivity.newValue, 500, 'New value should be 500');

// Rollback the edit!
vm.runInContext(`
  rollbackActivity('${editActivity.id}');
`, context);

const item101Reverted = vm.runInContext('data.items.find(i => i.id === "item-101")', context);
assert.strictEqual(item101Reverted.rate, 200, 'Rate should be rolled back to 200');
console.log('✓ Test 4: Cell edit is tracked and rolled back to previous value cleanly');

// Test 5: Toolbar Undo/Redo Arrow Buttons (No "Undo" or "Redo" text)
const sheetHtml = vm.runInContext('renderSheet()', context);
assert.ok(sheetHtml.includes('data-action="undo"'), 'Sheet toolbar should contain undo button');
assert.ok(sheetHtml.includes('data-action="redo"'), 'Sheet toolbar should contain redo button');
assert.ok(sheetHtml.includes('icon-btn'), 'Buttons should have icon-btn class');

// Verify that the button text does NOT contain "Undo" or "Redo"
const undoBtnMatch = sheetHtml.match(/<button[^>]*data-action="undo"[^>]*>(.*?)<\/button>/);
assert.ok(undoBtnMatch, 'Undo button must match');
assert.ok(!undoBtnMatch[1].includes('Undo'), 'Undo button must NOT have "Undo" text');
assert.ok(undoBtnMatch[1].includes('<svg'), 'Undo button must contain SVG arrow');

const redoBtnMatch = sheetHtml.match(/<button[^>]*data-action="redo"[^>]*>(.*?)<\/button>/);
assert.ok(redoBtnMatch, 'Redo button must match');
assert.ok(!redoBtnMatch[1].includes('Redo'), 'Redo button must NOT have "Redo" text');
assert.ok(redoBtnMatch[1].includes('<svg'), 'Redo button must contain SVG arrow');
console.log('✓ Test 5: Toolbar contains icon-only Undo and Redo curved arrow buttons without text labels');

// Test 6: Settings Activity History Panel
const settingsHtml = vm.runInContext('renderSettings()', context);
assert.ok(settingsHtml.includes('Activity Tracker & Rollback'), 'Settings should include Activity Tracker & Rollback section');
assert.ok(settingsHtml.includes('data-rollback-id'), 'Settings activity list should include Rollback buttons');
assert.ok(settingsHtml.includes('Clear Log'), 'Settings should have Clear Log button');
console.log('✓ Test 6: Settings tab renders the Activity Tracker & Rollback panel with live log');

console.log('\nALL 6 ACTIVITY TRACKER, ROLLBACK, UNDO/REDO & COPY-PASTE TESTS PASSED SUCCESSFULLY!');
