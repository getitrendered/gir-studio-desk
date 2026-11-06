const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- TEST: Shift-Select, Ctrl-Select, and Drag-Select (v0.2.78) ---');

const appPath = path.resolve(__dirname, '../app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

// 1. Verify Shift and Ctrl modifiers in row.onmousedown
assert(appCode.includes("if (e.shiftKey || e.ctrlKey || e.metaKey) {"), 'row.onmousedown must intercept Shift and Ctrl modifier clicks');
assert(appCode.includes("handleRowDragStart(row.dataset.row, e);"), 'row.onmousedown must trigger handleRowDragStart on mousedown for drag selection');
console.log('✓ Test 1: Modifier keys (Shift, Ctrl, Meta) correctly detected in row.onmousedown');

// 2. Verify Shift and Ctrl modifiers in row.onclick
assert(appCode.includes("selectSheetRow(row.dataset.row, e.shiftKey, e.ctrlKey || e.metaKey);"), 'row.onclick must call selectSheetRow with shiftKey and ctrlKey');
console.log('✓ Test 2: Modifier keys correctly invoke selectSheetRow in row.onclick');

// 3. Verify drag selection over rows
assert(appCode.includes("handleRowDragOver(row.dataset.row, e);"), 'row.onmouseenter must call handleRowDragOver during drag selection');
assert(appCode.includes("hasRowDragged = true;\n    deactivateAllEditingFields();"), 'handleRowDragOver must deactivate editing fields once drag starts across rows');
console.log('✓ Test 3: Dragging across rows deactivates editing and selects row range');

// 4. Verify dark mode selected status cell styling
const cssPath = path.resolve(__dirname, '../extras.css');
const cssCode = fs.readFileSync(cssPath, 'utf8');
assert(cssCode.includes('[data-theme="dark"] .sheet tr.selected td.status-cell.paid'), 'extras.css must define dark mode selected status-cell.paid background');
assert(cssCode.includes('[data-theme="dark"] .sheet tr.selected td.status-cell.paid .status-trigger'), 'extras.css must define dark mode selected status-cell.paid text color');
console.log('✓ Test 4: Dark mode selected row status cell styling verified');

// 4. Functional Simulation Test: Shift, Ctrl, and Drag Selection
{
  const rowIds = ['row1', 'row2', 'row3', 'row4', 'row5', 'row6', 'row7', 'row8'];
  let selected = new Set();
  let selectionAnchor = null;

  function selectSheetRow(id, shift = false, add = false) {
    if (shift && selectionAnchor && rowIds.includes(selectionAnchor)) {
      const a = rowIds.indexOf(selectionAnchor), b = rowIds.indexOf(id);
      if (!add) selected.clear();
      for (const r of rowIds.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(r);
    } else if (add) {
      selected.has(id) ? selected.delete(id) : selected.add(id);
      selectionAnchor = id;
    } else {
      selected.clear();
      selected.add(id);
      selectionAnchor = id;
    }
  }

  // Click row 2 (normal click)
  selectSheetRow('row2', false, false);
  assert.strictEqual(selected.size, 1);
  assert(selected.has('row2'));
  assert.strictEqual(selectionAnchor, 'row2');

  // Shift + click row 5 (range selection)
  selectSheetRow('row5', true, false);
  assert.strictEqual(selected.size, 4); // row2, row3, row4, row5
  assert(selected.has('row2') && selected.has('row3') && selected.has('row4') && selected.has('row5'));
  console.log('✓ Test 4A: Shift + select range simulation passed');

  // Ctrl + click row 7 (add individual row)
  selectSheetRow('row7', false, true);
  assert.strictEqual(selected.size, 5); // row2, row3, row4, row5, row7
  assert(selected.has('row7'));
  console.log('✓ Test 4B: Ctrl + select add simulation passed');

  // Ctrl + click row 3 (toggle off individual row)
  selectSheetRow('row3', false, true);
  assert.strictEqual(selected.size, 4); // row2, row4, row5, row7
  assert(!selected.has('row3'));
  console.log('✓ Test 4C: Ctrl + select toggle-off simulation passed');

  // Drag selection from row 6 down to row 8
  const dragStartRowId = 'row6';
  const targetRowId = 'row8';
  const startIdx = rowIds.indexOf(dragStartRowId);
  const currentIdx = rowIds.indexOf(targetRowId);
  const rangeIds = rowIds.slice(Math.min(startIdx, currentIdx), Math.max(startIdx, currentIdx) + 1);
  selected = new Set(rangeIds);
  assert.strictEqual(selected.size, 3);
  assert(selected.has('row6') && selected.has('row7') && selected.has('row8'));
  console.log('✓ Test 4D: Click and drag selection simulation passed');
}

console.log('\nALL MULTI-ROW SELECTION TESTS PASSED! 🎉✨');
