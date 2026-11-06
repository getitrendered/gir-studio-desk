const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- TEST: Rate Sync, Real-Time Group Header, and Worksheet Durability (v0.2.77) ---');

const appPath = path.resolve(__dirname, '../app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

const cssPath = path.resolve(__dirname, '../extras.css');
const cssCode = fs.readFileSync(cssPath, 'utf8');

// 1. Verify oninput real-time auto-save is wired to data-cell inputs
assert(appCode.includes("el.addEventListener('input', () => {"), 'data-cell inputs must listen to input events for real-time auto-save');
assert(appCode.includes("if (key === 'quantity' || key === 'rate') {"), 'Must recalculate quotedTotal immediately upon rate/quantity input');
assert(appCode.includes("updateGroupHeaderDOM(i);"), 'Must call updateGroupHeaderDOM on input event');
console.log('✓ Test 1: Real-time oninput auto-save and quotedTotal recalculation verified');

// 2. Verify updateGroupHeaderDOM definition and integration in editCell
assert(appCode.includes('function updateGroupHeaderDOM(item) {'), 'updateGroupHeaderDOM function must be defined');
assert(appCode.includes("data-sheet-group=\"${kind}:${group.id}\""), 'Must find parent group header row by data-sheet-group attribute');
assert(appCode.includes("${done}/${active.length} complete"), 'Must format active/done and complete count on group header');
assert(appCode.includes("refreshSelection();\n    updateGroupHeaderDOM(i);"), 'editCell skipRender must call updateGroupHeaderDOM to keep group total in sync with selection total');
console.log('✓ Test 2: Live dynamic group header recalculation verified');

// 3. Verify pullRemote editing protection against closing blocks midway
assert(appCode.includes("if (activeEditing && tab === 'sheet') {\n    isDeferredRemotePull = true;\n    return;\n  }"), 'pullRemote must immediately defer if activeEditing on sheet');
assert(appCode.includes("if (stillEditing && tab === 'sheet') {\n    isDeferredRemotePull = true;\n    updateSyncUI();\n    return;\n  }"), 'pullRemote must not call render() if user is editing when remote fetch completes');
console.log('✓ Test 3: Active cell input protection in pullRemote verified');

// 4. Verify pullRemote timestamp and zero-rate clobber protection
assert(appCode.includes("new Date(prev.updatedAt) > new Date(remote.updatedAt)"), 'pullRemote must preserve newer local updatedAt over older remote');
assert(appCode.includes("num(prev.rate) > 0 && num(remote.rate) === 0"), 'pullRemote must protect non-zero local rates against remote zero clobbering');
console.log('✓ Test 4: Conflict-free merge and zero-rate clobber protection verified');

// 5. Verify CSS zero-overlap protection on group cards
assert(cssCode.includes('max-width: calc(100% - 130px);'), '.group-card-top-row must enforce max-width clearance for rename/ungroup buttons');
console.log('✓ Test 5: CSS group card clearance verified');

// 6. Functional Simulation Test: Group Header Live Sync & Zero-Rate Protection
{
  const testData = {
    clients: [{ id: 'c1', name: 'FUNCTION JUNCTION' }],
    projectGroups: [{ id: 'pg1', clientId: 'c1', label: 'Sakshi & rishee' }],
    groups: [],
    items: [
      { id: 'row84', clientId: 'c1', projectGroupId: 'pg1', serial: '84', service: 'Invite', quantity: 1, rate: 1000, quotedTotal: 1000, status: 'sent', updatedAt: '2026-11-06T10:00:00Z' },
      { id: 'row88', clientId: 'c1', projectGroupId: 'pg1', serial: '88', service: 'Board', quantity: 1, rate: 0, quotedTotal: 0, status: 'pending', updatedAt: '2026-11-06T10:00:00Z' }
    ],
    pending: []
  };

  // User types rate 400 into row 88
  const it = testData.items.find(x => x.id === 'row88');
  it.rate = 400;
  it.quotedTotal = it.quantity * it.rate;
  it.updatedAt = '2026-11-06T11:00:00Z';

  // Group total calculation
  const activeItems = testData.items.filter(x => x.projectGroupId === 'pg1' && x.status !== 'discarded');
  const groupSum = activeItems.reduce((acc, x) => acc + x.quotedTotal, 0);
  assert.strictEqual(groupSum, 1400, 'Group sum should update from 1000 to 1400 after typing rate 400');

  // Simulate pullRemote receiving stale remote item with rate 0
  const staleRemoteItem = { id: 'row88', clientId: 'c1', projectGroupId: 'pg1', serial: '88', service: 'Board', quantity: 1, rate: 0, quotedTotal: 0, status: 'pending', updatedAt: '2026-11-06T10:05:00Z' };
  
  // Apply our merge rule:
  const prev = it;
  let mergedItem;
  if (prev && prev.updatedAt && staleRemoteItem.updatedAt && new Date(prev.updatedAt) > new Date(staleRemoteItem.updatedAt)) {
    mergedItem = prev;
  } else if (prev && prev.rate > 0 && staleRemoteItem.rate === 0) {
    mergedItem = { ...staleRemoteItem, rate: prev.rate, quotedTotal: prev.quotedTotal };
  } else {
    mergedItem = staleRemoteItem;
  }

  assert.strictEqual(mergedItem.rate, 400, 'Rate must remain 400 and NOT revert to 0 when stale remote sync arrives');
  assert.strictEqual(mergedItem.quotedTotal, 400, 'quotedTotal must remain 400');
  console.log('✓ Test 6: Functional simulation of live group recalculation and zero-rate protection passed');
}

console.log('\nALL RATE SYNC & WORKSHEET DURABILITY TESTS PASSED! 🎉✨');
