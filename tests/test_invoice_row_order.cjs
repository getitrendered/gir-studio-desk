const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('Testing Invoice Row Ordering according to Sheet / Group Placement (v0.2.88)...');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setupTestContext() {
  const context = {
    data: {
      clients: [
        { id: 'c1', name: 'Function Junction', billing: { name: 'Function Junction Goa' }, sortOrder: 0 }
      ],
      projectGroups: [
        { id: 'pg1', clientId: 'c1', label: 'Nivedita & Dheeraj' }
      ],
      groups: [
        { id: 'dg1', clientId: 'c1', label: 'Mandap Deal', agreedAmount: 35000 }
      ],
      // Store items in SCATTERED / REVERSE order in data.items array!
      items: [
        { id: 'row76', clientId: 'c1', projectGroupId: 'pg1', groupId: null, sortOrder: 75, serial: '76', service: 'TEAM BACKDROP - 6x8 FT', quantity: 1, rate: 400, quotedTotal: 400, advanceAmount: 0, status: 'sent' },
        { id: 'row52', clientId: 'c1', projectGroupId: 'pg1', groupId: null, sortOrder: 51, serial: '52', service: 'NIVEDITA & DHEERAJ - VIDEO INVITE', quantity: 2, rate: 1500, quotedTotal: 3000, advanceAmount: 0, status: 'sent' },
        { id: 'row60', clientId: 'c1', projectGroupId: 'pg1', groupId: null, sortOrder: 59, serial: '60', service: 'LOBBY SUNBOARDS - 2x5 FT', quantity: 2, rate: 400, quotedTotal: 800, advanceAmount: 0, status: 'sent' },
        { id: 'row53', clientId: 'c1', projectGroupId: 'pg1', groupId: null, sortOrder: 52, serial: '53', service: 'NIVEDITA & DHEERAJ - MONOGRAM', quantity: 1, rate: 1000, quotedTotal: 1000, advanceAmount: 0, status: 'paid' },
        { id: 'row55', clientId: 'c1', projectGroupId: 'pg1', groupId: null, sortOrder: 54, serial: '55', service: 'NIVEDITA & DHEERAJ - WELCOME NOTE', quantity: 1, rate: 1000, quotedTotal: 1000, advanceAmount: 0, status: 'sent' }
      ],
      invoices: [],
      receipts: [],
      settings: { workspaceId: 'ws-1', seller: { name: 'GIR Studio Desk' } }
    },
    activeClient: 'c1',
    tab: 'sheet',
    selected: new Set(),
    billedIds: () => new Set(),
    currentClient: () => context.data.clients.find(c => c.id === context.activeClient),
    currentUserId: () => 'local-me',
    today: () => '2026-11-16',
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
    refreshSelection: () => {},
    closeModal: () => {},
    render: () => {},
    modalTitle: '',
    modalHtml: '',
    modalActions: '',
    modal: (title, body, actions) => {
      context.modalTitle = title;
      context.modalHtml = body;
      context.modalActions = actions || '';
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
          remove: () => {},
          addEventListener: () => {},
          focus: () => {}
        };
      }
      return context.elements[selector];
    },
    $$: () => [],
    document: {
      getElementById: id => context.elements['#' + id] || null,
      querySelector: sel => context.elements[sel] || { innerHTML: '', textContent: '' },
      createElement: () => ({ id: '', className: '', innerHTML: '', remove: () => {} }),
      body: { appendChild: () => {} }
    },
    setTimeout: (fn) => fn()
  };

  vm.createContext(context);

  // Extract clientItems and groupedSheetItems
  const take = (start, end) => appJs.slice(appJs.indexOf(start), appJs.indexOf(end, appJs.indexOf(start)));
  vm.runInContext(take('function clientItems(', 'function displayStatus('), context);
  vm.runInContext(take('function groupedSheetItems(', 'function renderSheet('), context);
  vm.runInContext(take('function invoiceGroup(', 'function ungroupDialog('), context);
  vm.runInContext(take('function invoiceDialog()', 'function deleteInvoiceDialog('), context);

  return context;
}

// Test 1: Verify getOrderedInvoiceItems sorts items strictly in sheet order
{
  const ctx = setupTestContext();

  // In data.items, rows are: row76, row52, row60, row53, row55
  // On the sheet, they should be sorted by sortOrder/sheet structure:
  // 1. row52 (sortOrder 51)
  // 2. row53 (sortOrder 52)
  // 3. row55 (sortOrder 54)
  // 4. row60 (sortOrder 59)
  // 5. row76 (sortOrder 75)
  ctx.selected.add('row76');
  ctx.selected.add('row52');
  ctx.selected.add('row60');
  ctx.selected.add('row53');
  ctx.selected.add('row55');

  ctx.invoiceDialog();

  assert.equal(ctx.modalTitle, 'Create invoice');

  // Verify the preview list order in modal HTML
  const pos52 = ctx.modalHtml.indexOf('VIDEO INVITE');
  const pos53 = ctx.modalHtml.indexOf('MONOGRAM');
  const pos55 = ctx.modalHtml.indexOf('WELCOME NOTE');
  const pos60 = ctx.modalHtml.indexOf('LOBBY SUNBOARDS');
  const pos76 = ctx.modalHtml.indexOf('TEAM BACKDROP');

  assert.ok(pos52 !== -1 && pos53 !== -1 && pos55 !== -1 && pos60 !== -1 && pos76 !== -1, 'All items must appear in preview');
  assert.ok(pos52 < pos53, 'Row 52 must appear before Row 53');
  assert.ok(pos53 < pos55, 'Row 53 must appear before Row 55');
  assert.ok(pos55 < pos60, 'Row 55 must appear before Row 60');
  assert.ok(pos60 < pos76, 'Row 60 must appear before Row 76');

  // Create itemized invoice
  ctx.$('#createInvoice').onclick();

  assert.equal(ctx.data.invoices.length, 1);
  const inv = ctx.data.invoices[0];
  assert.equal(inv.lines.length, 5);

  // Assert line 1..5 order matches sheet placement exactly
  assert.equal(inv.lines[0].service, 'NIVEDITA & DHEERAJ - VIDEO INVITE');
  assert.equal(inv.lines[0].serial, 1);
  assert.equal(inv.lines[1].service, 'NIVEDITA & DHEERAJ - MONOGRAM');
  assert.equal(inv.lines[1].serial, 2);
  assert.equal(inv.lines[2].service, 'NIVEDITA & DHEERAJ - WELCOME NOTE');
  assert.equal(inv.lines[2].serial, 3);
  assert.equal(inv.lines[3].service, 'LOBBY SUNBOARDS - 2x5 FT');
  assert.equal(inv.lines[3].serial, 4);
  assert.equal(inv.lines[4].service, 'TEAM BACKDROP - 6x8 FT');
  assert.equal(inv.lines[4].serial, 5);

  assert.deepEqual([...inv.itemIds], ['row52', 'row53', 'row55', 'row60', 'row76'], 'itemIds must match sheet order');
  console.log('✔ Test 1: Invoice created from scattered rows outputs lines in exact sheet order');
}

// Test 2: invoiceGroup automatically selects and creates invoice in sheet order
{
  const ctx = setupTestContext();

  // Trigger invoiceGroup on project group pg1
  ctx.invoiceGroup('project', 'pg1');

  // Click create invoice
  ctx.$('#createInvoice').onclick();

  assert.equal(ctx.data.invoices.length, 1);
  const inv = ctx.data.invoices[0];

  assert.deepEqual([...inv.itemIds], ['row52', 'row53', 'row55', 'row60', 'row76']);
  assert.equal(inv.lines[0].service, 'NIVEDITA & DHEERAJ - VIDEO INVITE');
  assert.equal(inv.lines[4].service, 'TEAM BACKDROP - 6x8 FT');
  console.log('✔ Test 2: invoiceGroup selects and generates invoice in sheet order');
}

// Test 3: alignInvoiceLinesWithSheetOrder re-aligns existing invoices
{
  const ctx = setupTestContext();

  // Create an old invoice where lines were stored in scattered order
  const scatteredInvoice = {
    id: 'old-inv-1',
    clientId: 'c1',
    number: 'GIR-2026-0001',
    issueDate: '2026-11-10',
    itemIds: ['row76', 'row52', 'row60'],
    lines: [
      { serial: 1, service: 'TEAM BACKDROP - 6x8 FT', quantity: 1, rate: 400, total: 400 },
      { serial: 2, service: 'NIVEDITA & DHEERAJ - VIDEO INVITE', quantity: 2, rate: 1500, total: 3000 },
      { serial: 3, service: 'LOBBY SUNBOARDS - 2x5 FT', quantity: 2, rate: 400, total: 800 }
    ],
    originalLines: [
      { serial: 1, service: 'TEAM BACKDROP - 6x8 FT', quantity: 1, rate: 400, total: 400 },
      { serial: 2, service: 'NIVEDITA & DHEERAJ - VIDEO INVITE', quantity: 2, rate: 1500, total: 3000 },
      { serial: 3, service: 'LOBBY SUNBOARDS - 2x5 FT', quantity: 2, rate: 400, total: 800 }
    ],
    subtotal: 4200,
    finalAmount: 4200,
    status: 'issued',
    isLumpSum: false
  };

  ctx.data.invoices.push(scatteredInvoice);

  // View invoice
  ctx.viewInvoice('old-inv-1');

  // Verify that viewing it automatically aligned lines and itemIds to sheet order
  assert.deepEqual([...scatteredInvoice.itemIds], ['row52', 'row60', 'row76']);
  assert.equal(scatteredInvoice.lines[0].service, 'NIVEDITA & DHEERAJ - VIDEO INVITE');
  assert.equal(scatteredInvoice.lines[0].serial, 1);
  assert.equal(scatteredInvoice.lines[1].service, 'LOBBY SUNBOARDS - 2x5 FT');
  assert.equal(scatteredInvoice.lines[1].serial, 2);
  assert.equal(scatteredInvoice.lines[2].service, 'TEAM BACKDROP - 6x8 FT');
  assert.equal(scatteredInvoice.lines[2].serial, 3);
  console.log('✔ Test 3: Existing invoice lines automatically re-align to sheet order upon viewing');
}

console.log('\nALL INVOICE ROW ORDERING TESTS PASSED! 🎉📄✨');
