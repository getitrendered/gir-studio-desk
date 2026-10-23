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
  window: { 
    desk: { write: async () => true, read: async () => null, updates: { onChange: () => {}, state: async () => ({}) } },
    addEventListener: () => {}
  },
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

console.log('Testing Row Deletion, Undo (Ctrl+Z), Redo (Ctrl+Y), and Lag Optimization...');

// Setup test client with 5 items
vm.runInContext(`
  data.clients = [{ id: 'client-1', name: 'Acme Studio', billing: {} }];
  activeClient = 'client-1';
  tab = 'sheet';
  data.items = [
    { id: 'row-1', clientId: 'client-1', groupId: null, projectGroupId: null, sortOrder: 0, serial: '1', service: 'Floorplan 3D', quantity: 1, rate: 4000, quotedTotal: 4000, advanceAmount: 0, status: 'pending', remarks: '' },
    { id: 'row-2', clientId: 'client-1', groupId: null, projectGroupId: null, sortOrder: 1, serial: '2', service: 'Elevation Render', quantity: 2, rate: 3000, quotedTotal: 6000, advanceAmount: 0, status: 'working', remarks: '' },
    { id: 'row-3', clientId: 'client-1', groupId: null, projectGroupId: null, sortOrder: 2, serial: '3', service: 'Color Grading', quantity: 3, rate: 1000, quotedTotal: 3000, advanceAmount: 0, status: 'pending', remarks: '' },
    { id: 'row-4', clientId: 'client-1', groupId: null, projectGroupId: null, sortOrder: 3, serial: '4', service: 'Walkthrough Video', quantity: 1, rate: 12000, quotedTotal: 12000, advanceAmount: 0, status: 'sent', remarks: '' },
    { id: 'row-5', clientId: 'client-1', groupId: null, projectGroupId: null, sortOrder: 4, serial: '5', service: 'Flyer Design', quantity: 1, rate: 1500, quotedTotal: 1500, advanceAmount: 0, status: 'paid', remarks: '' }
  ];
  undoStack.length = 0;
  redoStack.length = 0;
`, context);

// Test 1: Delete a single row
vm.runInContext(`
  selected.clear();
  selected.add('row-2');
  deleteSelectedRows();
`, context);

let items = vm.runInContext('clientItems()', context);
assert.strictEqual(items.length, 4, 'Items count should be 4 after deleting row-2');
assert.strictEqual(items.find(i => i.id === 'row-2'), undefined, 'row-2 should be removed');
assert.strictEqual(items[0].serial, '1');
assert.strictEqual(items[1].serial, '2', 'row-3 should now have serial 2');
assert.strictEqual(items[2].serial, '3', 'row-4 should now have serial 3');
assert.strictEqual(items[3].serial, '4', 'row-5 should now have serial 4');
assert.ok(vm.runInContext('data.pendingDeletes.some(d => d.table === "items" && d.id === "row-2")', context), 'row-2 should be registered in pendingDeletes for sync');
console.log('✓ Test 1: Single row deletion re-indexes sequential serial numbers and logs pending delete');

// Test 2: Undo row deletion (Ctrl+Z)
vm.runInContext(`
  undo();
`, context);

items = vm.runInContext('clientItems()', context);
assert.strictEqual(items.length, 5, 'Items count should be restored to 5 on undo');
assert.ok(items.find(i => i.id === 'row-2'), 'row-2 should be restored');
assert.strictEqual(items[1].id, 'row-2');
assert.strictEqual(items[1].serial, '2');
console.log('✓ Test 2: Undo (Ctrl+Z) cleanly restores deleted row and previous serial numbers');

// Test 3: Redo row deletion (Ctrl+Y)
vm.runInContext(`
  redo();
`, context);

items = vm.runInContext('clientItems()', context);
assert.strictEqual(items.length, 4, 'Items count should be 4 again on redo');
assert.strictEqual(items.find(i => i.id === 'row-2'), undefined, 'row-2 should be re-deleted');
console.log('✓ Test 3: Redo (Ctrl+Y) re-applies row deletion');

// Test 4: Delete multiple rows simultaneously
vm.runInContext(`
  selected.clear();
  selected.add('row-3');
  selected.add('row-4');
  deleteSelectedRows();
`, context);

items = vm.runInContext('clientItems()', context);
assert.strictEqual(items.length, 2, 'Should have 2 items remaining after deleting 2 rows');
assert.strictEqual(items[0].id, 'row-1');
assert.strictEqual(items[0].serial, '1');
assert.strictEqual(items[1].id, 'row-5');
assert.strictEqual(items[1].serial, '2');
console.log('✓ Test 4: Multiple row deletion properly re-sequences remaining rows');

// Test 5: Undo multiple row deletion
vm.runInContext(`
  undo();
`, context);

items = vm.runInContext('clientItems()', context);
assert.strictEqual(items.length, 4, 'Should restore the 2 rows back to 4 items');
console.log('✓ Test 5: Undo successfully restores multiple deleted rows');

// Test 6: Cell Edit and Undo
vm.runInContext(`
  editCell('row-1', 'service', 'Super Luxury 3D Villa');
`, context);

let row1 = vm.runInContext('data.items.find(i => i.id === "row-1")', context);
assert.strictEqual(row1.service, 'Super Luxury 3D Villa');

vm.runInContext(`
  undo();
`, context);

row1 = vm.runInContext('data.items.find(i => i.id === "row-1")', context);
assert.strictEqual(row1.service, 'Floorplan 3D', 'Cell edit should be reverted on undo');

vm.runInContext(`
  redo();
`, context);

row1 = vm.runInContext('data.items.find(i => i.id === "row-1")', context);
assert.strictEqual(row1.service, 'Super Luxury 3D Villa', 'Cell edit should be re-applied on redo');
console.log('✓ Test 6: Cell edits support Undo (Ctrl+Z) and Redo (Ctrl+Y)');

// Test 7: Performance benchmark on large dataset (1,000 items)
vm.runInContext(`
  const bigList = [];
  for (let i = 0; i < 1000; i++) {
    bigList.push({
      id: 'perf-' + i,
      clientId: 'client-1',
      projectGroupId: (i % 10 === 0) ? 'proj-' + (i % 3) : null,
      groupId: (i % 5 === 0) ? 'deal-' + (i % 4) : null,
      sortOrder: i,
      serial: String(i + 1),
      service: 'Service ' + i,
      quantity: 1,
      rate: 100,
      quotedTotal: 100,
      status: 'pending'
    });
  }
  const t0 = Date.now();
  const sorted = groupedSheetItems(bigList);
  const duration = Date.now() - t0;
`, context);

const perfDuration = vm.runInContext('duration', context);
console.log(`✓ Test 7: Performance on 1,000 rows executed in ${perfDuration}ms (smooth, zero lag)`);
assert.ok(perfDuration < 50, `1000 items groupedSheetItems should execute under 50ms (got ${perfDuration}ms)`);

console.log('ALL ROW DELETION, UNDO, REDO, AND PERFORMANCE TESTS PASSED!');
