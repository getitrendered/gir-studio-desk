const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('Testing Edit Group Deal on Paid Groups (v0.2.90)...');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// 1. Static assertions on app.js
assert.ok(appJs.includes('resetToRowTotalBtn'), 'app.js must have resetToRowTotalBtn');
assert.ok(appJs.includes('convertToProjectGroupBtn'), 'app.js must have convertToProjectGroupBtn');
assert.ok(appJs.includes('group-card-deal-link'), 'app.js must have group-card-deal-link');
assert.ok(appJs.includes('group-header-deal-link'), 'app.js must have group-header-deal-link');

// 2. Build VM environment to test groupHeader and renderGroups
function buildTestEnv() {
  const sandbox = {
    console,
    Date,
    Math,
    Set,
    Map,
    Array,
    Object,
    JSON,
    Number,
    today: () => '2026-11-21',
    validDate: s => s,
    num: n => Number(n) || 0,
    money: n => '₹' + Number(n).toLocaleString('en-IN'),
    esc: s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    collapsedGroups: new Set(),
    activeClient: 'c1',
    data: {
      clients: [{ id: 'c1', name: 'Nivedita Client' }],
      projectGroups: [
        { id: 'pg1', clientId: 'c1', label: 'Project Alpha' }
      ],
      groups: [
        { id: 'dg1', clientId: 'c1', label: 'Nivedita & Dheeraj Deal', agreedAmount: 17700 }
      ],
      items: [
        { id: 'i1', clientId: 'c1', groupId: 'dg1', service: 'Video', quantity: 1, rate: 10000, quotedTotal: 10000, advanceAmount: 0, status: 'paid', paidAt: '2026-11-21' },
        { id: 'i2', clientId: 'c1', groupId: 'dg1', service: 'Cards', quantity: 1, rate: 7700, quotedTotal: 7700, advanceAmount: 0, status: 'paid', paidAt: '2026-11-21' }
      ],
      invoices: [],
      receipts: []
    },
    billedIds: () => new Set(),
    toast: msg => { sandbox.lastToast = msg; },
    enqueue: (table, id) => { sandbox.enqueued.push({ table, id }); },
    mutate: (table, obj) => {
      sandbox.mutated.push({ table, obj });
      const list = sandbox.data[table] || [];
      const idx = list.findIndex(x => x.id === obj.id);
      if (idx >= 0) list[idx] = obj;
      else list.push(obj);
    },
    removeReceipt: id => {
      sandbox.data.receipts = (sandbox.data.receipts || []).filter(r => r.id !== id);
    },
    createReceipt: (clientId, amount, desc, kind, refId, stamp) => {
      const r = { id: 'rec_' + refId, clientId, amount, description: desc, referenceKind: kind, referenceId: refId, receivedOn: '2026-11-21', receivedMonth: '2026-11-01' };
      sandbox.data.receipts.push(r);
      return r;
    },
    pushUndo: () => {},
    save: () => {},
    scheduleSync: () => {},
    closeModal: () => {},
    render: () => {},
    lastToast: '',
    enqueued: [],
    mutated: []
  };

  const context = vm.createContext(sandbox);

  // Extract functions from app.js
  const helperCode = `
    ${appJs.match(/function groupTotalValue\b[\s\S]*?\n\}/)[0]}
    ${appJs.match(/function groupStatus\b[\s\S]*?\n\}/)[0]}
    ${appJs.match(/function groupHeader\b[\s\S]*?\n\}/)[0]}
    ${appJs.match(/function renderGroups\b[\s\S]*?\n\}/)[0]}
    ${appJs.match(/function syncDealReceipt\b[\s\S]*?\n\}/)[0]}
    ${appJs.match(/function effectiveItemValue\b[\s\S]*?\n\}/)[0]}
  `;
  vm.runInContext(helperCode, context);
  return context;
}

const env = buildTestEnv();

// Test 1: groupHeader for a PAID deal group
const dg1 = env.data.groups[0];
const dg1Items = env.data.items.filter(i => i.groupId === dg1.id);
const headerHtml = env.groupHeader('deal', dg1, dg1Items);

assert.ok(headerHtml.includes('is-paid-group-row'), 'Must have is-paid-group-row class');
assert.ok(headerHtml.includes('Paid in full'), 'Must show Paid in full seal');
assert.ok(headerHtml.includes('data-group-deal="deal:dg1"'), 'Must have data-group-deal button on paid group header');
assert.ok(headerHtml.includes('Edit deal'), 'Button label must be Edit deal when agreed is true');
assert.ok(headerHtml.includes('group-header-deal-link'), 'Header detail must have group-header-deal-link class');
assert.ok(headerHtml.includes('Agreed ₹17,700 ✏️'), 'Header detail must render Agreed amount with edit indicator');

console.log('✓ groupHeader on paid group renders Edit deal button and clickable agreed amount');

// Test 2: renderGroups for a PAID deal group
const groupsHtml = env.renderGroups();
assert.ok(groupsHtml.includes('data-group-deal-card="deal:dg1"'), 'renderGroups must have data-group-deal-card for paid group');
assert.ok(groupsHtml.includes('Edit deal'), 'renderGroups must have Edit deal button on paid group card');
assert.ok(groupsHtml.includes('group-card-deal-link'), 'renderGroups must render group-card-deal-link on amount');
assert.ok(groupsHtml.includes('Agreed ₹17,700 ✏️'), 'renderGroups must render clickable Agreed amount with pencil indicator');

console.log('✓ renderGroups on paid group renders Edit deal button and clickable agreed amount');

// Test 3: syncDealReceipt updates receipt amount when agreedAmount changes on paid group
env.syncDealReceipt('dg1');
assert.strictEqual(env.data.receipts.length, 1, 'Should have 1 receipt for deal group');
assert.strictEqual(env.data.receipts[0].amount, 17700, 'Receipt amount should match agreed amount 17700');

// Now user edits deal amount to 19000
dg1.agreedAmount = 19000;
env.syncDealReceipt('dg1');
assert.strictEqual(env.data.receipts[0].amount, 19000, 'Receipt amount should update to 19000 after edit');
console.log('✓ syncDealReceipt updates receipt amount to new agreed deal amount on paid group');

// Test 4: Reset deal amount to row total (agreedAmount = null)
dg1.agreedAmount = null;
env.syncDealReceipt('dg1');
assert.strictEqual(env.data.receipts[0].amount, 17700, 'Receipt amount should revert to sum of rows (10000 + 7700 = 17700)');

const headerReverted = env.groupHeader('deal', dg1, dg1Items);
assert.ok(headerReverted.includes('Group deal'), 'Button label should be Group deal when agreedAmount is null');
assert.ok(!headerReverted.includes('Agreed ₹'), 'Should not show Agreed when agreedAmount is null');
assert.ok(headerReverted.includes('Total ₹17,700'), 'Should show Total when agreedAmount is null');

console.log('✓ Resetting agreed deal amount toggles back to row totals');

console.log('\nAll edit paid group deal tests passed successfully!');
