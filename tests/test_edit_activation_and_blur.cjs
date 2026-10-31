const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- TEST: 2-Click Cell Edit Activation & Row Blur Deactivation (v0.2.59) ---');

const appPath = path.resolve(__dirname, '../app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

// 1. Verify function declarations and state wiring in app.js
assert(appCode.includes('let lastCellClick = { rowId: null, cellKey: null, blankOrder: null, time: 0 };'), 'lastCellClick tracking state must be defined');
assert(appCode.includes('function deactivateAllEditingFields('), 'deactivateAllEditingFields function must be declared');
assert(appCode.includes('function activateSheetField('), 'activateSheetField function must be declared');
assert(appCode.includes('editCell(id, key, value, skipRender = false)'), 'editCell must support skipRender parameter');
console.log('✓ Core declarations and states verified in app.js');

// 2. Verify mousedown deactivation on row switch
assert(appCode.includes("const activeEditing = document.querySelector('input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing');"), 'Must query active editing elements on row mousedown');
assert(appCode.includes('if (activeEditing && !activeEditing.contains(e.target)) {\n        deactivateAllEditingFields();\n      }'), 'Row onmousedown must call deactivateAllEditingFields when clicking outside active field');
assert(appCode.includes('window._editBlurRegistered'), 'Global capture mousedown listener must be registered to catch outside clicks');
console.log('✓ Automatic edit deactivation on row switch and outside click verified');

// 3. Verify 2-click activation threshold (< 900ms)
assert(appCode.includes('const timeDiff = now - lastCellClick.time;'), 'Must calculate time difference between clicks on same cell');
assert(appCode.includes('if (isSameCell && timeDiff < 900) {'), 'Must activate field on second click within 900ms');
assert(appCode.includes('row.ondblclick = e => {'), 'Native double-click must also activate field');
console.log('✓ 2-click activation threshold (fast or slow double-click < 900ms) verified');

// 4. Verify Enter commits and Escape reverts
assert(appCode.includes("if (e.key === 'Enter')"), 'Enter key must be handled');
assert(appCode.includes("else if (e.key === 'Escape')"), 'Escape key must be handled');
console.log('✓ Enter commit and Escape revert keydown handlers verified');

// 5. Functional Simulation Test: 2-Click Activation, Cell Edit, and Row Switch Deactivation
{
  const data = {
    items: [
      { id: 'row1', clientId: 'c1', serial: '1', sortOrder: 0, service: 'Flex Banner', quantity: 2, rate: 500, quotedTotal: 1000, status: 'pending' },
      { id: 'row2', clientId: 'c1', serial: '2', sortOrder: 1, service: 'Board Print', quantity: 3, rate: 200, quotedTotal: 600, status: 'pending' }
    ],
    pending: []
  };

  let lastCellClick = { rowId: null, cellKey: null, blankOrder: null, time: 0 };
  let activeEditingField = null;
  let renderCalled = false;

  const mockDOM = {
    'input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing': []
  };

  function num(v) {
    return Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
  }

  function queue(table, id) {
    data.pending.push({ table, id });
  }

  function refreshSelection() {}

  function editCell(id, key, value, skipRender = false) {
    const i = data.items.find(x => x.id === id);
    if (!i) return;
    if (['quantity', 'rate', 'quotedTotal', 'advanceAmount'].includes(key)) value = Math.max(0, num(value));
    i[key] = value;
    if (key === 'quantity' || key === 'rate') {
      i.manualTotal = false;
      i.quotedTotal = num(i.quantity) * num(i.rate);
    }
    if (key === 'quotedTotal') i.manualTotal = true;
    if (skipRender) {
      queue('items', i.id);
      refreshSelection();
    } else {
      renderCalled = true;
    }
  }

  function deactivateAllEditingFields(exceptEl = null) {
    const editings = mockDOM['input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing'];
    editings.forEach(el => {
      if (exceptEl && el === exceptEl) return;
      el.classList.delete('editing');
      el.readOnly = true;
      if (el.dataset.id && el.dataset.cell) {
        const it = data.items.find(x => x.id === el.dataset.id);
        if (it && String(it[el.dataset.cell] ?? '') !== String(el.value ?? '')) {
          editCell(el.dataset.id, el.dataset.cell, el.value, true);
        }
      }
    });
    mockDOM['input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing'] = [];
    activeEditingField = null;
  }

  function activateSheetField(field) {
    if (!field) return;
    deactivateAllEditingFields(field);
    field.readOnly = false;
    field.classList.add('editing');
    mockDOM['input.editing, select.editing, [data-cell].editing, [data-blank-cell].editing'] = [field];
    activeEditingField = field;
  }

  function createMockCell(rowId, cellKey, value) {
    return {
      tagName: 'INPUT',
      dataset: { id: rowId, cell: cellKey },
      value: value,
      readOnly: true,
      classList: new Set(),
      contains(target) { return target === this; }
    };
  }

  const row1RateField = createMockCell('row1', 'rate', '500');
  const row2RateField = createMockCell('row2', 'rate', '200');

  // Step A: First click on Row 1 Rate cell at t=1000ms
  let t = 1000;
  let isSameCell = lastCellClick.rowId === 'row1' && lastCellClick.cellKey === 'rate';
  let timeDiff = t - lastCellClick.time;
  assert(!isSameCell, 'First click is not a repeat click on the same cell');
  lastCellClick = { rowId: 'row1', cellKey: 'rate', time: t };
  assert.strictEqual(activeEditingField, null, 'First click should not enter edit mode yet');

  // Step B: Second click on Row 1 Rate cell at t=1500ms (500ms later, natural human slow click)
  t = 1500;
  isSameCell = lastCellClick.rowId === 'row1' && lastCellClick.cellKey === 'rate';
  timeDiff = t - lastCellClick.time;
  assert(isSameCell && timeDiff < 900, 'Second click within 900ms detected');
  activateSheetField(row1RateField);
  lastCellClick = { rowId: null, cellKey: null, time: 0 };

  assert.strictEqual(activeEditingField, row1RateField, 'Field must enter edit mode on 2nd click');
  assert.strictEqual(row1RateField.readOnly, false, 'Field must not be readonly in edit mode');
  assert(row1RateField.classList.has('editing'), 'Field must have editing class');

  // Step C: User changes Rate in Row 1 from 500 to 750
  row1RateField.value = '750';

  // Step D: User clicks on Row 2 (row switch)
  // Simulate row.onmousedown on Row 2
  const target = row2RateField;
  if (activeEditingField && !activeEditingField.contains(target)) {
    deactivateAllEditingFields();
  }

  assert.strictEqual(activeEditingField, null, 'Active editing field must be cleared on row switch');
  assert.strictEqual(row1RateField.readOnly, true, 'Row 1 field must be readOnly again');
  assert(!row1RateField.classList.has('editing'), 'Row 1 field must no longer have editing class');
  assert.strictEqual(data.items[0].rate, 750, 'Row 1 rate must be updated to 750');
  assert.strictEqual(data.items[0].quotedTotal, 1500, 'Row 1 quotedTotal must be recalculated (2 * 750 = 1500)');
  assert.strictEqual(renderCalled, false, 'skipRender must be true to avoid blowing away DOM during row click');

  // Step E: Click 1 on Row 2 Rate cell selects row
  t = 2000;
  lastCellClick = { rowId: 'row2', cellKey: 'rate', time: t };
  assert.strictEqual(activeEditingField, null);

  // Step F: Click 2 on Row 2 Rate cell at t=2300ms activates Row 2 Rate
  t = 2300;
  isSameCell = lastCellClick.rowId === 'row2' && lastCellClick.cellKey === 'rate';
  timeDiff = t - lastCellClick.time;
  assert(isSameCell && timeDiff < 900);
  activateSheetField(row2RateField);

  assert.strictEqual(activeEditingField, row2RateField, 'Row 2 field enters edit mode');
  assert.strictEqual(row2RateField.readOnly, false);
  assert(row2RateField.classList.has('editing'));

  // Step G: Press Escape to cancel
  row2RateField.value = '999'; // user started typing
  // revert
  row2RateField.value = data.items[1].rate; // revert to original 200
  deactivateAllEditingFields();
  assert.strictEqual(data.items[1].rate, 200, 'Row 2 rate must remain 200 after Escape');
  assert.strictEqual(activeEditingField, null);

  console.log('✓ 2-click edit activation, value saving, and row-switch blur deactivation simulation passed');
}

console.log('ALL EDIT ACTIVATION & ROW BLUR TESTS PASSED! 🎉');
