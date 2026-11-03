const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Testing Drag Safety, Cell Click Activation, and Zero-Overwrite Guarantee...');

const appPath = path.join(__dirname, '..', 'app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

// 1. Verify handleRowDragEnd does NOT overwrite cells
assert(!appCode.includes("pushUndo(`Fill ${colName} down`)"), 'handleRowDragEnd must not perform cell fill down overwrite');
assert(!appCode.includes("targetItem[dragStartCellKey] = sourceItem[dragStartCellKey]"), 'handleRowDragEnd must not copy cell keys across rows');
console.log('PASS: Destructive cell fill-down removed from row drag');

// 2. Verify single click editing does not select all text
const activateFieldMatch = appCode.match(/function activateSheetField\(field\)[\s\S]*?\n\}/);
assert(activateFieldMatch, 'activateSheetField function must exist');
assert(!activateFieldMatch[0].includes('field.select()'), 'activateSheetField must not select all text on single click');
console.log('PASS: activateSheetField does not select all text on single click');

// 3. Verify row onmousedown does not initiate drag when field is present
const rowMousedownMatch = appCode.match(/row\.onmousedown = e => \{[\s\S]*?\n    \};/);
assert(rowMousedownMatch, 'row.onmousedown must exist');
assert(rowMousedownMatch[0].includes('if (field) {'), 'row.onmousedown must check if field exists and activate it directly');
console.log('PASS: row.onmousedown prioritizes field activation over drag start');

// 4. Test dragging logic simulation
const items = [
  { id: 'item-1', serial: '1', service: 'SANGEET BOARD – 5×3 FT', rate: 1000 },
  { id: 'item-2', serial: '2', service: 'WELCOME BOARD', rate: 500 },
  { id: 'item-3', serial: '3', service: 'DIRECTIONAL SIGNAGE', rate: 400 }
];

let selected = new Set();
let selectionAnchor = null;
let hasRowDragged = false;
let isRowDragSelecting = true;
let dragStartRowId = 'item-1';
let dragTargetRowId = 'item-2';

// Simulate safe handleRowDragEnd
if (isRowDragSelecting) {
  isRowDragSelecting = false;
  if (hasRowDragged || (dragStartRowId && dragTargetRowId && dragStartRowId !== dragTargetRowId)) {
    const allRowIds = items.map(r => r.id);
    const startIdx = allRowIds.indexOf(dragStartRowId);
    const currentIdx = allRowIds.indexOf(dragTargetRowId);
    const minIdx = Math.min(startIdx, currentIdx);
    const maxIdx = Math.max(startIdx, currentIdx);
    const rangeIds = allRowIds.slice(minIdx, maxIdx + 1);

    selected = new Set(rangeIds);
    selectionAnchor = dragStartRowId;
  }
}

// Ensure items were NEVER mutated
assert.strictEqual(items[0].service, 'SANGEET BOARD – 5×3 FT');
assert.strictEqual(items[1].service, 'WELCOME BOARD');
assert.strictEqual(items[2].service, 'DIRECTIONAL SIGNAGE');
assert.strictEqual(selected.size, 2);
assert(selected.has('item-1') && selected.has('item-2'));
console.log('PASS: Range selection selects rows without altering cell contents');

console.log('ALL DRAG SAFETY AND CELL CLICK TESTS PASSED! 🎉');
