const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('Testing Group "Mark Paid" functionality & Invoiced Item Status Healing (v0.2.89)...');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Verify key code changes in app.js
assert.ok(appJs.includes('function healInvoicedItemStatuses()'), 'app.js must declare healInvoicedItemStatuses()');
assert.ok(appJs.includes('healInvoicedItemStatuses();'), 'app.js must call healInvoicedItemStatuses()');

// Extract essential functions from app.js to run in VM
function buildTestEnvironment() {
  const sandbox = {
    console,
    Date,
    Math,
    Set,
    Map,
    Array,
    Object,
    JSON,
    today: () => '2026-11-20',
    validDate: s => s,
    num: n => Number(n) || 0,
    cleanSerial: s => String(s || '').trim(),
    effectiveItemValue: i => Number(i.quotedTotal) || 0,
    invoiceAdvance: inv => Number(inv.advanceAmount) || 0,
    currentUserId: () => 'user-samuel',
    toast: (msg) => { sandbox.lastToast = msg; },
    enqueue: (table, id) => { sandbox.enqueued.push({ table, id }); },
    queue: (table, id) => { sandbox.enqueued.push({ table, id }); },
    save: () => { sandbox.saved = true; },
    scheduleSync: () => {},
    render: () => { sandbox.rendered = true; },
    closeModal: () => {},
    modal: () => {},
    pushUndo: () => {},
    lastToast: '',
    enqueued: [],
    saved: false,
    rendered: false,
    data: {
      clients: [{ id: 'c_fj', name: 'Function Junction', billing: {} }],
      projectGroups: [{ id: 'pg_nivedita', clientId: 'c_fj', label: 'Nivedita & Dheeraj' }],
      groups: [{ id: 'dg_deal', clientId: 'c_fj', label: 'Wedding Deal', agreedAmount: 50000 }],
      items: [],
      invoices: [],
      receipts: [],
      settings: { displayName: 'Samuel' }
    },
    selected: new Set(),
    activeClient: 'c_fj',
    collapsedGroups: new Set(),
    createReceipt: (clientId, amount, desc, kind, refId, stamp) => {
      const r = {
        id: 'rec_' + Math.random().toString(36).slice(2),
        clientId,
        amount,
        description: desc,
        referenceKind: kind,
        referenceId: refId,
        receivedOn: stamp ? stamp.slice(0, 10) : '2026-11-20',
        receivedMonth: (stamp ? stamp.slice(0, 7) : '2026-11') + '-01',
        receivedAt: stamp || '2026-11-20T12:00:00.000Z'
      };
      sandbox.data.receipts.push(r);
      return r;
    },
    removeReceipt: (id) => {
      const idx = sandbox.data.receipts.findIndex(r => r.id === id);
      if (idx >= 0) sandbox.data.receipts.splice(idx, 1);
    }
  };

  const context = vm.createContext(sandbox);

  // Load functions from app.js into sandbox
  function sliceFunction(name) {
    const start = appJs.indexOf(`function ${name}(`);
    assert.ok(start !== -1, `Function ${name} not found in app.js`);
    let depth = 0;
    let end = start;
    let foundOpen = false;
    for (let i = start; i < appJs.length; i++) {
      if (appJs[i] === '{') {
        depth++;
        foundOpen = true;
      } else if (appJs[i] === '}') {
        depth--;
        if (foundOpen && depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    return appJs.slice(start, end);
  }

  const scripts = [
    sliceFunction('billedIds'),
    sliceFunction('groupStatus'),
    sliceFunction('syncDealReceipt'),
    sliceFunction('syncProjectReceipt'),
    sliceFunction('syncItemReceipt'),
    sliceFunction('recordPaidItems'),
    sliceFunction('bulkSetStatus'),
    sliceFunction('healInvoicedItemStatuses')
  ];

  for (const s of scripts) {
    vm.runInContext(s, context);
  }

  return sandbox;
}

// Test 1: Project group with rows on an existing paid invoice
// (Exact Samuel scenario: Invoice was marked paid, but group was left in Sent status)
{
  const env = buildTestEnvironment();
  const itemIds = [];
  for (let i = 1; i <= 28; i++) {
    const id = `item_${i}`;
    itemIds.push(id);
    env.data.items.push({
      id,
      clientId: 'c_fj',
      projectGroupId: 'pg_nivedita',
      groupId: null,
      status: 'sent',
      service: `Task ${i}`,
      quantity: 1,
      rate: 1000,
      quotedTotal: 1000,
      advanceAmount: 0
    });
  }

  // Invoice exists and has status = 'paid'
  env.data.invoices.push({
    id: 'inv_gir_0004',
    clientId: 'c_fj',
    number: 'GIR-2026-0004',
    status: 'paid',
    itemIds: [...itemIds],
    finalAmount: 28000,
    advanceAmount: 0,
    paidAt: '2026-11-20',
    paidAtTs: '2026-11-20T14:24:11.83+00:00'
  });

  // Verify groupStatus before is 'Sent'
  const itemsBefore = env.data.items.filter(i => i.projectGroupId === 'pg_nivedita');
  assert.equal(env.groupStatus(itemsBefore), 'Sent', 'Group should initially be Sent');

  // Trigger group "Mark Paid":
  const rows = env.data.items.filter(i => i.projectGroupId === 'pg_nivedita' && i.status !== 'discarded' && i.status !== 'paid');
  assert.equal(rows.length, 28, '28 rows should be ready to mark paid');

  env.bulkSetStatus('paid', rows.map(i => i.id), { kind: 'project', id: 'pg_nivedita', label: 'Nivedita & Dheeraj' });

  // Verify all 28 rows are now paid
  for (const item of env.data.items) {
    assert.equal(item.status, 'paid', `Item ${item.id} must have status 'paid'`);
    assert.equal(item.paidAt, '2026-11-20', `Item ${item.id} must have paidAt date`);
  }

  // Verify groupStatus is now 'Paid'
  const itemsAfter = env.data.items.filter(i => i.projectGroupId === 'pg_nivedita');
  assert.equal(env.groupStatus(itemsAfter), 'Paid', 'Group status must now be Paid');
  console.log('✔ Test 1: Group Mark Paid on invoiced project rows marks all rows as Paid');
}

// Test 2: Startup Self-Healing on already-paid invoices
{
  const env = buildTestEnvironment();
  const itemIds = [];
  for (let i = 1; i <= 28; i++) {
    const id = `item_heal_${i}`;
    itemIds.push(id);
    env.data.items.push({
      id,
      clientId: 'c_fj',
      projectGroupId: 'pg_nivedita',
      groupId: null,
      status: 'sent', // stuck in sent
      service: `Task ${i}`,
      quantity: 1,
      rate: 1000,
      quotedTotal: 1000
    });
  }

  env.data.invoices.push({
    id: 'inv_gir_0004',
    clientId: 'c_fj',
    number: 'GIR-2026-0004',
    status: 'paid',
    itemIds: [...itemIds],
    finalAmount: 28000,
    paidAt: '2026-11-20',
    paidAtTs: '2026-11-20T14:24:11.83+00:00'
  });

  const healed = env.healInvoicedItemStatuses();
  assert.equal(healed, true, 'healInvoicedItemStatuses must report true when rows healed');

  for (const item of env.data.items) {
    assert.equal(item.status, 'paid', `Healed item ${item.id} must have status 'paid'`);
    assert.equal(item.paidAt, '2026-11-20');
  }

  const items = env.data.items.filter(i => i.projectGroupId === 'pg_nivedita');
  assert.equal(env.groupStatus(items), 'Paid', 'Group must be Paid after self-healing');
  console.log('✔ Test 2: Startup self-healing automatically updates rows on paid invoices');
}

// Test 3: Group Mark Paid when invoice is currently in 'issued' status
{
  const env = buildTestEnvironment();
  const itemIds = ['d1', 'd2', 'd3'];
  for (const id of itemIds) {
    env.data.items.push({
      id,
      clientId: 'c_fj',
      projectGroupId: null,
      groupId: 'dg_deal',
      status: 'sent',
      service: 'Deal item ' + id,
      quantity: 1,
      rate: 10000,
      quotedTotal: 10000
    });
  }

  const inv = {
    id: 'inv_deal',
    clientId: 'c_fj',
    number: 'GIR-2026-0005',
    status: 'issued',
    itemIds: [...itemIds],
    finalAmount: 30000,
    advanceAmount: 0
  };
  env.data.invoices.push(inv);

  // Click Mark Paid on Deal Group
  const rows = env.data.items.filter(i => i.groupId === 'dg_deal' && i.status !== 'discarded' && i.status !== 'paid');
  env.bulkSetStatus('paid', rows.map(i => i.id), { kind: 'deal', id: 'dg_deal', label: 'Wedding Deal' });

  // Both the invoice and all rows should be paid
  assert.equal(inv.status, 'paid', 'Linked invoice must be updated to paid');
  for (const it of env.data.items) {
    assert.equal(it.status, 'paid', `Deal row ${it.id} must be paid`);
  }
  const items = env.data.items.filter(i => i.groupId === 'dg_deal');
  assert.equal(env.groupStatus(items), 'Paid', 'Deal group must be Paid');
  console.log('✔ Test 3: Group Mark Paid on issued invoice marks both invoice and items as Paid');
}

// Test 4: Group Mark Paid without invoice
{
  const env = buildTestEnvironment();
  for (let i = 1; i <= 5; i++) {
    env.data.items.push({
      id: `standalone_${i}`,
      clientId: 'c_fj',
      projectGroupId: 'pg_nivedita',
      groupId: null,
      status: i === 1 ? 'sent' : 'pending',
      service: `Item ${i}`,
      quantity: 1,
      rate: 1000,
      quotedTotal: 1000
    });
  }

  const rows = env.data.items.filter(i => i.projectGroupId === 'pg_nivedita' && i.status !== 'discarded' && i.status !== 'paid');
  env.bulkSetStatus('paid', rows.map(i => i.id), { kind: 'project', id: 'pg_nivedita', label: 'Nivedita & Dheeraj' });

  for (const it of env.data.items) {
    assert.equal(it.status, 'paid', `Row ${it.id} must be paid`);
  }
  const items = env.data.items.filter(i => i.projectGroupId === 'pg_nivedita');
  assert.equal(env.groupStatus(items), 'Paid', 'Group must be Paid');
  console.log('✔ Test 4: Group Mark Paid on non-invoiced items marks all rows as Paid');
}

console.log('\nALL GROUP MARK PAID TESTS PASSED! 🎉💵✅');
