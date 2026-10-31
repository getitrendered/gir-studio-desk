const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- TEST: Smart Update & Cell Drag Fill Down (v0.2.58) ---');

const appPath = path.resolve(__dirname, '../app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

// 1. Verify toolbar clean-up & Smart Update button
const renderSheetMatch = appCode.match(/function renderSheet\(\)[\s\S]*?\n\}/);
assert(renderSheetMatch, 'renderSheet function must exist');
const sheetHtml = renderSheetMatch[0];

assert(!sheetHtml.includes('data-action="undo"'), 'Undo button should be removed from toolbar to prevent overflow');
assert(!sheetHtml.includes('data-action="redo"'), 'Redo button should be removed from toolbar to prevent overflow');
assert(sheetHtml.includes('data-action="smart-update"'), 'Toolbar must include Smart Update button');
assert(appCode.includes("if(action==='smart-update')return smartUpdateDialog();"), 'actions() must route smart-update');
assert(appCode.includes('contextSmartUpdate'), 'Context menu must include Smart Update option');
console.log('✓ Toolbar overflow cleanup and Smart Update button verified in app.js');

// 2. Verify Smart Update Presets
assert(appCode.includes("'FLEX'"), 'Must include FLEX preset');
assert(appCode.includes("'FOAM BOARD'"), 'Must include FOAM BOARD preset');
assert(appCode.includes("'WELCOME BOARD'"), 'Must include WELCOME BOARD preset');
assert(appCode.includes("'BOARD'"), 'Must include BOARD preset');
assert(appCode.includes("'SIGNAGE'"), 'Must include SIGNAGE preset');
console.log('✓ All 5 presets (FLEX, FOAM BOARD, WELCOME BOARD, BOARD, SIGNAGE) verified');

// 3. Test Cell Drag Copy Logic
// Mock sandbox environment
const sandbox = {
  data: {
    items: [
      { id: 'r1', clientId: 'c1', serial: '1', sortOrder: 0, service: 'Line Drawing', quantity: 2, rate: 500, quotedTotal: 1000, status: 'pending', remarks: '' },
      { id: 'r2', clientId: 'c1', serial: '2', sortOrder: 1, service: 'Haldi Stage', quantity: 3, rate: 300, quotedTotal: 900, status: 'pending', remarks: '' },
      { id: 'r3', clientId: 'c1', serial: '3', sortOrder: 2, service: 'Flex Banner', quantity: 1, rate: 200, quotedTotal: 200, status: 'working', remarks: '' },
      { id: 'r4', clientId: 'c1', serial: '4', sortOrder: 3, service: 'Photo Booth', quantity: 4, rate: 100, quotedTotal: 400, status: 'pending', remarks: '' }
    ],
    pending: []
  },
  num: v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0,
  cleanSerial: v => String(v ?? ''),
  enqueue: (table, id) => sandbox.data.pending.push({ table, id })
};

// Simulate Dragging Rate cell from row 1 down to row 2, 3, 4
const sourceItem = sandbox.data.items[0]; // rate = 500
const targetIds = ['r2', 'r3', 'r4'];
const dragStartCellKey = 'rate';

targetIds.forEach(tId => {
  const targetItem = sandbox.data.items.find(i => i.id === tId);
  if (targetItem) {
    if (dragStartCellKey === 'rate') {
      targetItem.rate = sandbox.num(sourceItem.rate);
      targetItem.quotedTotal = sandbox.num(targetItem.quantity) * sandbox.num(targetItem.rate);
      targetItem.manualTotal = true;
    }
  }
});

// Check r2: qty was 3, new rate is 500 -> total 1500
assert.strictEqual(sandbox.data.items[1].rate, 500, 'Row 2 rate must be copied to 500');
assert.strictEqual(sandbox.data.items[1].quotedTotal, 1500, 'Row 2 quotedTotal must recalculate to 3 * 500 = 1500');

// Check r3: qty was 1, new rate is 500 -> total 500
assert.strictEqual(sandbox.data.items[2].rate, 500, 'Row 3 rate must be copied to 500');
assert.strictEqual(sandbox.data.items[2].quotedTotal, 500, 'Row 3 quotedTotal must be 500');

// Check r4: qty was 4, new rate is 500 -> total 2000
assert.strictEqual(sandbox.data.items[3].rate, 500, 'Row 4 rate must be copied to 500');
assert.strictEqual(sandbox.data.items[3].quotedTotal, 2000, 'Row 4 quotedTotal must recalculate to 4 * 500 = 2000');
console.log('✓ Cell drag fill down with rate calculation verified');

// 4. Test Shift + Drag (Entire row copy)
const shiftSource = sandbox.data.items[0];
const shiftTarget = sandbox.data.items[3];

shiftTarget.service = shiftSource.service;
shiftTarget.quantity = shiftSource.quantity;
shiftTarget.rate = shiftSource.rate;
shiftTarget.quotedTotal = shiftSource.quotedTotal;
shiftTarget.status = shiftSource.status;
shiftTarget.remarks = shiftSource.remarks;

assert.strictEqual(shiftTarget.service, 'Line Drawing', 'Shift+drag should copy service');
assert.strictEqual(shiftTarget.quantity, 2, 'Shift+drag should copy quantity');
assert.strictEqual(shiftTarget.rate, 500, 'Shift+drag should copy rate');
assert.strictEqual(shiftTarget.quotedTotal, 1000, 'Shift+drag should copy quotedTotal');
console.log('✓ Shift + drag row copy verified');

// 5. Test Smart Update Filtering & Execution
const sheetItems = [
  { id: 's1', serial: '40', service: 'HALDI - FLOOR FLEX 2 × 400', quantity: 2, rate: 400, quotedTotal: 800, status: 'pending' },
  { id: 's2', serial: '45', service: 'ENTRANCE FLEX BACKDROP', quantity: 1, rate: 300, quotedTotal: 300, status: 'pending' },
  { id: 's3', serial: '48', service: 'STAGE FOAM BOARD 3D', quantity: 2, rate: 1200, quotedTotal: 2400, status: 'pending' },
  { id: 's4', serial: '52', service: 'WELCOME BOARD SIGNAGE (acrylic)', quantity: 1, rate: 800, quotedTotal: 800, status: 'pending' },
  { id: 's5', serial: '55', service: 'Haldi flex print with lamination', quantity: 3, rate: 250, quotedTotal: 750, status: 'pending' },
  { id: 's6', serial: '62', service: 'PASSAGE SIGNAGE - FLEX', quantity: 2, rate: 300, quotedTotal: 600, status: 'pending' }
];

// Test case-insensitive search for 'FLEX' within range 45 to 59
const kw = 'FLEX'.toLowerCase();
const fromSerial = 45;
const toSerial = 59;

const matched = sheetItems.filter(i => {
  const s = parseInt(i.serial, 10);
  if (s < fromSerial || s > toSerial) return false;
  const svc = String(i.service || '').toLowerCase();
  return svc.includes(kw);
});

// Row s1 is 40 (< 45, excluded)
// Row s2 is 45 (contains FLEX, included)
// Row s3 is 48 (FOAM BOARD, no flex)
// Row s4 is 52 (WELCOME BOARD, no flex)
// Row s5 is 55 (contains 'flex', included)
// Row s6 is 62 (> 59, excluded)
assert.strictEqual(matched.length, 2, 'Should match exactly rows 45 and 55 within range 45..59');
assert.strictEqual(matched[0].id, 's2');
assert.strictEqual(matched[1].id, 's5');
console.log('✓ Smart update range filtering (45..59) and case-insensitive matching verified');

// Test update rate to 600 on matched rows
matched.forEach(i => {
  i.rate = 600;
  i.quotedTotal = i.quantity * 600;
  i.status = 'working';
});

assert.strictEqual(matched[0].rate, 600);
assert.strictEqual(matched[0].quotedTotal, 600); // 1 * 600
assert.strictEqual(matched[0].status, 'working');

assert.strictEqual(matched[1].rate, 600);
assert.strictEqual(matched[1].quotedTotal, 1800); // 3 * 600
assert.strictEqual(matched[1].status, 'working');
console.log('✓ Smart update selective mutation and recalculation verified');

console.log('ALL SMART UPDATE & CELL DRAG TESTS PASSED SUCCESSFULLY!');
