const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setupTestEnvironment() {
  const context = {
    data: {
      clients: [{ id: 'c1', name: 'Bling it on', billing: { name: 'Bling Billing', email: 'billing@bling.com' } }],
      groups: [
        { id: 'g-deal-1', clientId: 'c1', label: 'BAGA IGNITE X 2026', agreedAmount: 70000 }
      ],
      projectGroups: [],
      items: [
        { id: 'i1', clientId: 'c1', service: '3D MANDAP', quantity: 1, rate: 3000, quotedTotal: 3000, advanceAmount: 500, status: 'sent', groupId: 'g-deal-1' },
        { id: 'i2', clientId: 'c1', service: 'STAGE DESIGN', quantity: 2, rate: 4000, quotedTotal: 8000, advanceAmount: 0, status: 'sent', groupId: 'g-deal-1' },
        { id: 'i3', clientId: 'c1', service: 'VIP ENTRY', quantity: 1, rate: 5000, quotedTotal: 5000, advanceAmount: 0, status: 'sent', groupId: null },
        { id: 'i4', clientId: 'c1', service: 'LIGHTING SETUP', quantity: 1, rate: 6000, quotedTotal: 6000, advanceAmount: 1000, status: 'sent', groupId: null }
      ],
      invoices: [],
      receipts: [],
      members: [],
      chatMessages: [],
      pending: [],
      settings: { workspaceId: 'ws-test', seller: { name: 'GIR Studios' } }
    },
    selected: new Set(),
    activeClient: 'c1',
    billedIds: () => new Set(),
    currentClient: () => context.data.clients.find(c => c.id === context.activeClient),
    currentUserId: () => 'user-me',
    today: () => '2026-10-30',
    fmtDate: d => d || '',
    money: n => '₹' + Number(n || 0).toLocaleString('en-IN'),
    num: v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0,
    esc: v => String(v ?? ''),
    cleanSerial: v => String(v || ''),
    validDate: s => s,
    structuredClone: x => JSON.parse(JSON.stringify(x)),
    uid: (() => { let n = 0; return () => `inv-${++n}`; })(),
    toast: msg => { context.lastToast = msg; },
    mutate: (table, row) => {
      if (table === 'invoices') {
        const idx = context.data.invoices.findIndex(x => x.id === row.id);
        if (idx >= 0) context.data.invoices[idx] = row;
        else context.data.invoices.push(row);
      }
    },
    save: () => {},
    render: () => {},
    modalTitle: '',
    modalHtml: '',
    modalActions: '',
    modal: (title, body, actions) => {
      context.modalTitle = title;
      context.modalHtml = body;
      context.modalActions = actions || '';
    },
    closeModal: () => {
      context.modalTitle = '';
      context.modalHtml = '';
      context.modalActions = '';
    },
    elements: {},
    inputValue: id => (context.elements['#' + id] ? context.elements['#' + id].value : ''),
    $: selector => {
      if (!context.elements[selector]) {
        context.elements[selector] = {
          value: '',
          style: {},
          textContent: '',
          innerHTML: '',
          classList: { add: () => {}, remove: () => {}, toggle: () => {} },
          addEventListener: () => {},
          focus: () => {}
        };
      }
      return context.elements[selector];
    },
    $$: () => [],
    document: {
      getElementById: id => context.elements['#' + id] || null,
      querySelector: sel => context.elements[sel] || { innerHTML: '', textContent: '' }
    },
    window: { desk: { print: async () => {} } }
  };

  vm.createContext(context);

  const take = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const codeToRun =
    take('function invoiceDialog()', 'function deleteInvoiceDialog(') +
    take('function remoteRow(table, x)', 'function setupSupabase()');

  vm.runInContext(codeToRun, context);
  return context;
}

console.log('Testing Lump Sum Invoices, Group Deals Default, and Toggle Modes...\n');

// Test 1: Standard rows default to Breakup, toggle to Lump Sum, custom description & amount
{
  const ctx = setupTestEnvironment();
  // Select standard non-deal rows i3 and i4
  ctx.selected.add('i3');
  ctx.selected.add('i4');

  ctx.invoiceDialog();

  assert(ctx.modalTitle.includes('Create invoice'), 'Modal should open');
  assert(ctx.modalHtml.includes('Show as Lump Sum'), 'Button should offer "Show as Lump Sum" when starting in breakup mode');
  assert(ctx.modalHtml.includes('VIP ENTRY'), 'Breakup list should show individual services');
  assert(ctx.modalHtml.includes('LIGHTING SETUP'), 'Breakup list should show individual services');

  // Click toggle to Lump Sum mode
  ctx.$('#toggleInvoiceMode').onclick();

  assert(ctx.modalHtml.includes('Show Breakup'), 'Button should now offer "Show Breakup"');
  assert(ctx.modalHtml.includes('lumpSumService'), 'Should display lumpSumService input');
  assert(ctx.modalHtml.includes('lumpSumAmount'), 'Should display lumpSumAmount input');

  // Alter description and amount as requested by user
  ctx.$('#lumpSumService').value = 'Stage and Entry Package';
  ctx.$('#lumpSumAmount').value = '15000'; // Alter entire lump sum amount from 11000 to 15000

  // Click Create Invoice
  ctx.$('#createInvoice').onclick();

  assert.equal(ctx.data.invoices.length, 1);
  const inv = ctx.data.invoices[0];
  assert.equal(inv.isLumpSum, true);
  assert.equal(inv.lumpSumDescription, 'Stage and Entry Package');
  assert.equal(inv.lines.length, 1, 'Lump sum invoice must have exactly 1 line');
  assert.equal(inv.lines[0].service, 'Stage and Entry Package');
  assert.equal(inv.lines[0].total, 15000);
  assert.equal(inv.finalAmount, 15000);
  assert.equal(inv.originalLines.length, 2, 'Should preserve the 2 original itemized breakup lines');
  console.log('✓ Test 1: Standard rows toggle to Lump Sum with custom name & amount passed');
}

// Test 2: Group deals by default open in Lump Sum mode with deal label & agreed amount
{
  const ctx = setupTestEnvironment();
  // Select deal rows i1 and i2 (belonging to BAGA IGNITE X 2026 agreed deal of 70,000)
  ctx.selected.add('i1');
  ctx.selected.add('i2');

  ctx.invoiceDialog();

  // MUST default to Lump Sum mode because it is a group deal!
  assert(ctx.modalHtml.includes('Show Breakup'), 'Group deal invoice must default to Lump Sum mode with toggle to Breakup');
  assert(ctx.modalHtml.includes('lumpSumService'), 'Must show lump sum description input');
  assert(ctx.modalHtml.includes('BAGA IGNITE X 2026'), 'Must use group deal label as default service description');
  assert(ctx.modalHtml.includes('70000'), 'Must use agreed deal amount (70,000) as default amount');

  // Test toggling to Breakup
  ctx.$('#toggleInvoiceMode').onclick();
  assert(ctx.modalHtml.includes('Show as Lump Sum'), 'After clicking Show Breakup, toggle button should offer Show as Lump Sum');
  assert(ctx.modalHtml.includes('3D MANDAP'), 'Should show individual 3D MANDAP row in breakup');
  assert(ctx.modalHtml.includes('STAGE DESIGN'), 'Should show individual STAGE DESIGN row in breakup');

  // Toggle back to Lump Sum
  ctx.$('#toggleInvoiceMode').onclick();
  assert(ctx.modalHtml.includes('Show Breakup'), 'Should return to Lump Sum mode');

  // Create invoice in default lump sum mode
  ctx.$('#createInvoice').onclick();

  assert.equal(ctx.data.invoices.length, 1);
  const inv = ctx.data.invoices[0];
  assert.equal(inv.isLumpSum, true);
  assert.equal(inv.lines.length, 1);
  assert.equal(inv.lines[0].service, 'BAGA IGNITE X 2026');
  assert.equal(inv.lines[0].total, 70000);
  assert.equal(inv.finalAmount, 70000);
  console.log('✓ Test 2: Group deals default to Lump Sum with deal label & agreed amount passed');
}

// Test 3: Viewing invoice allows seamless toggling between Lump Sum and Breakup view
{
  const ctx = setupTestEnvironment();
  const inv = {
    id: 'inv-toggle-test',
    clientId: 'c1',
    number: 'GIR-2026-0099',
    issueDate: '2026-10-30',
    itemIds: ['i1', 'i2'],
    isLumpSum: true,
    lumpSumDescription: 'BAGA IGNITE X 2026',
    originalLines: [
      { serial: 1, service: '3D MANDAP', quantity: 1, rate: 3000, total: 3000 },
      { serial: 2, service: 'STAGE DESIGN', quantity: 2, rate: 4000, total: 8000 }
    ],
    lines: [
      { serial: 1, service: 'BAGA IGNITE X 2026', quantity: 1, rate: 70000, total: 70000 }
    ],
    subtotal: 70000,
    discount: 0,
    finalAmount: 70000,
    advanceAmount: 500,
    status: 'issued',
    seller: { name: 'GIR' },
    buyer: { name: 'Bling it on' }
  };
  ctx.data.invoices.push(inv);

  ctx.viewInvoice('inv-toggle-test');

  assert(ctx.modalActions.includes('Show Breakup'), 'View actions must offer "Show Breakup" for lump sum invoice');
  assert(ctx.modalHtml.includes('LUMP SUM'), 'Invoice header must show LUMP SUM badge');
  assert(ctx.modalHtml.includes('BAGA IGNITE X 2026'), 'Invoice table must show lump sum row');

  // Toggle to Breakup view
  ctx.$('#toggleViewInvoiceMode').onclick();
  assert.equal(inv.isLumpSum, false);
  assert.equal(inv.lines.length, 2, 'Should expand back to 2 lines in breakup mode');
  assert.equal(inv.lines[0].service, '3D MANDAP');
  assert.equal(inv.lines[1].service, 'STAGE DESIGN');

  // Toggle back to Lump Sum view
  ctx.$('#toggleViewInvoiceMode').onclick();
  assert.equal(inv.isLumpSum, true);
  assert.equal(inv.lines.length, 1, 'Should consolidate back to 1 line in lump sum mode');
  assert.equal(inv.lines[0].service, 'BAGA IGNITE X 2026');
  console.log('✓ Test 3: viewInvoice interactive toggle between Breakup and Lump Sum passed');
}

// Test 4: remoteRow and localRow serialization roundtrip
{
  const ctx = setupTestEnvironment();
  const inv = {
    id: 'inv-sync-1',
    clientId: 'c1',
    number: 'GIR-2026-0001',
    issueDate: '2026-10-30',
    itemIds: ['i1', 'i2'],
    isLumpSum: true,
    lumpSumDescription: 'Full Decor Package',
    originalLines: [{ serial: 1, service: 'A', quantity: 1, rate: 100, total: 100 }],
    lines: [{ serial: 1, service: 'Full Decor Package', quantity: 1, rate: 100, total: 100 }],
    subtotal: 100,
    discount: 0,
    finalAmount: 100,
    advanceAmount: 0,
    status: 'issued',
    seller: { name: 'GIR' },
    buyer: {}
  };

  const remote = ctx.remoteRow('invoices', inv);
  assert.equal(remote.seller.lumpSum.isLumpSum, true);
  assert.equal(remote.seller.lumpSum.lumpSumDescription, 'Full Decor Package');
  assert.equal(remote.seller.lumpSum.originalLines.length, 1);

  const local = ctx.localRow('invoices', remote);
  assert.equal(local.isLumpSum, true);
  assert.equal(local.lumpSumDescription, 'Full Decor Package');
  assert.equal(local.originalLines.length, 1);
  console.log('✓ Test 4: remoteRow and localRow serialization roundtrip passed');
}

console.log('\nALL LUMP SUM AND INVOICE TESTS PASSED! 🎉\n');
