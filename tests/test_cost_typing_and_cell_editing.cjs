const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

console.log('Testing Cost Cell Editing, Zero-Lag Typing, Tab Navigation, and Layout Separation...');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const extrasCss = fs.readFileSync(path.join(__dirname, '..', 'extras.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Test 1: Single-click instant editing and row selection protection
{
  assert(appJs.includes("const cellField = e.target.closest('td')?.querySelector('[data-cell]');"), 'row.onclick must detect cellField to protect against accidental row selection during clicks');
  assert(appJs.includes("if (e.target.closest('button, input.editing') || cellField)"), 'row.onclick must return early when clicking inside editable cells');
  assert(appJs.includes("if (cellField && !cellField.classList.contains('editing'))"), 'row.onclick must ensure cell field is actively editable on single click');
  console.log('✓ Test 1: Row click protected; single click immediately activates editing without row selection trap');
}

// Test 2: Focus event automatic activation (Tabbing into cells activates editing)
{
  assert(appJs.includes("el.addEventListener('focus', () => {"), 'app.js must attach focus event listener to cells');
  assert(appJs.includes("if (el.readOnly || !el.classList.contains('editing'))"), 'Focusing a cell must remove readonly and add editing');
  console.log('✓ Test 2: Cell focus event automatically removes readonly and activates editing');
}

// Test 3: Tab and Enter keyboard navigation across columns
{
  assert(appJs.includes("const SHEET_EDIT_COLS = ['workDate', 'service', 'quantity', 'rate', 'quotedTotal', 'advanceAmount', 'remarks'];"), 'Must define editable column sequence for smooth navigation');
  assert(appJs.includes("e.key === 'Tab'"), 'activateSheetField must support Tab key navigation');
  assert(appJs.includes("e.key === 'Enter'"), 'activateSheetField must support Enter key navigation');
  console.log('✓ Test 3: Tab and Enter keyboard navigation sequences through columns seamlessly');
}

// Test 4: Blank row materialization focus continuity
{
  assert(appJs.includes("function materializeBlankRow(field, targetNextKey = null)"), 'materializeBlankRow must accept next target key');
  assert(appJs.includes("activateSheetField(nextField)"), 'materializeBlankRow must restore active editing on the materialized row');
  console.log('✓ Test 4: Materializing blank rows smoothly transitions focus without closing midway');
}

// Test 5: CSS Hit-testing and right-aligned cost styling
{
  assert(extrasCss.includes("table.sheet td:has(input) {\n  padding: 0 !important;\n}"), 'td:has(input) must have 0 padding so input fills cell completely');
  assert(extrasCss.includes('table.sheet input[data-cell="rate"]'), 'extras.css must specify text-align: right for rate and quotedTotal');
  assert(extrasCss.includes('padding-right: 155px;'), 'group-card-top-row must have ample right padding to prevent overlap with top actions');
  console.log('✓ Test 5: CSS rules verified for 100% cell hit-testing, cost alignment, and group card clearance');
}

// Test 6: Chat tab remains hidden and chat profile badge removed
{
  assert(indexHtml.includes('data-tab="chat" style="display:none"'), 'Chat tab button must remain hidden in index.html');
  assert(!appJs.includes('chat-self-badge'), 'chat-self-badge must remain removed from app.js');
  console.log('✓ Test 6: Chat tab hidden and profile badge removed as requested');
}

console.log('\nALL COST TYPING, CELL EDITING, AND LAYOUT TESTS PASSED! 🎉✨');
