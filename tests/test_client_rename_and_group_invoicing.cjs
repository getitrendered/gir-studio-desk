const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('Testing Client Name Updating and Group Select All / Invoicing (v0.2.87)...');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const extrasCss = fs.readFileSync(path.join(__dirname, '..', 'extras.css'), 'utf8');

// Test 1: Verify presence of UI hooks and buttons in code
assert.ok(appJs.includes('id="clientMainName"'), 'billingDialog must have #clientMainName input for client name');
assert.ok(appJs.includes('data-group-select='), 'groupHeader must render data-group-select button');
assert.ok(appJs.includes('data-group-invoice='), 'groupHeader must render data-group-invoice button');
assert.ok(appJs.includes('data-group-card-invoice='), 'renderGroups must render data-group-card-invoice button');
assert.ok(appJs.includes('contextGroupSelectAll'), 'Group context menu must include contextGroupSelectAll');
assert.ok(appJs.includes('contextGroupInvoice'), 'Group context menu must include contextGroupInvoice');
assert.ok(extrasCss.includes('.group-quick.invoice-btn'), 'extras.css must style .invoice-btn');
assert.ok(extrasCss.includes('.group-quick.select-btn'), 'extras.css must style .select-btn');
console.log('✔ Test 1: Markup, buttons, context menus, and styles verified');

// Test 2: Client renaming logic and receipt synchronization
function setupClientContext() {
  const context = {
    data: {
      clients: [
        { id: 'c_tn', name: 'TN', billing: { name: 'TN', address: '', email: 'info@tn.com', phone: '', taxId: '' }, sortOrder: 0 },
        { id: 'c_fj', name: 'Function Junction', billing: { name: 'FJ Events Ltd', address: '', email: '', phone: '', taxId: '' }, sortOrder: 1 }
      ],
      projectGroups: [
        { id: 'pg1', clientId: 'c_tn', label: 'Wedding Stage' }
      ],
      groups: [
        { id: 'dg1', clientId: 'c_tn', label: 'Sound Deal', agreedAmount: 25000 }
      ],
      items: [
        { id: 'it1', clientId: 'c_tn', projectGroupId: 'pg1', groupId: null, status: 'sent', service: 'Stage Lights', quantity: 1, rate: 10000, quotedTotal: 10000, advanceAmount: 0 },
        { id: 'it2', clientId: 'c_tn', projectGroupId: 'pg1', groupId: null, status: 'paid', service: 'Trussing', quantity: 1, rate: 8000, quotedTotal: 8000, advanceAmount: 0 },
        { id: 'it3', clientId: 'c_tn', projectGroupId: 'pg1', groupId: null, status: 'pending', service: 'Fog Machine', quantity: 1, rate: 2000, quotedTotal: 2000, advanceAmount: 0 },
        { id: 'it4', clientId: 'c_fj', projectGroupId: null, groupId: null, status: 'sent', service: 'Audio Console', quantity: 1, rate: 5000, quotedTotal: 5000, advanceAmount: 0 }
      ],
      invoices: [],
      receipts: [
        { id: 'rec1', clientId: 'c_tn', clientName: 'TN', amount: 8000, receivedMonth: '2026-11' }
      ]
    },
    activeClient: 'c_tn',
    tab: 'sheet',
    selected: new Set(),
    lastModal: null,
    lastToast: '',
    renderedCount: 0,
    esc: s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    num: v => Number(v) || 0,
    money: v => '₹' + Number(v || 0).toLocaleString('en-IN'),
    toast: msg => { context.lastToast = msg; },
    closeModal: () => { context.lastModal = null; },
    render: () => { context.renderedCount++; },
    mutate: (table, row) => {},
    queue: (table, id) => {},
    billedIds: () => new Set(context.data.invoices.flatMap(inv => inv.itemIds || [])),
    refreshSelection: () => {}
  };

  // Mock DOM
  const domInputs = {};
  const getEl = id => {
    const key = id.startsWith('#') ? id : '#' + id;
    if (!domInputs[key]) domInputs[key] = { value: '', classList: { add(){}, remove(){}, toggle(){} } };
    return domInputs[key];
  };
  context.$ = getEl;
  context.inputValue = id => getEl(id).value.trim();
  context.modal = (title, body, actions) => {
    context.lastModal = { title, body, actions };
  };

  return { context, getEl };
}

{
  const { context, getEl } = setupClientContext();

  // Extract billingDialog from app.js using vm
  const billingDialogMatch = appJs.match(/function billingDialog\(id=activeClient\)\{[\s\S]*?\n\}/);
  assert.ok(billingDialogMatch, 'billingDialog function must be extractable');
  vm.runInNewContext(billingDialogMatch[0], context);

  // Invoke billingDialog for c_tn
  context.billingDialog('c_tn');
  assert.ok(context.lastModal, 'billingDialog must display modal');
  assert.equal(context.lastModal.title, 'Client & billing details');
  assert.ok(context.lastModal.body.includes('id="clientMainName"'), 'Modal must contain clientMainName input');

  // Populate inputs: User changes "TN" to "TN once"
  getEl('clientMainName').value = 'TN once';
  getEl('billName').value = 'TN once Pvt Ltd';
  getEl('billAddress').value = 'Panjim, Goa';
  getEl('billEmail').value = 'contact@tnonce.com';
  getEl('billPhone').value = '9876543210';
  getEl('billTax').value = 'GST12345';

  // Trigger Save
  getEl('#saveBilling').onclick();

  const tn = context.data.clients.find(c => c.id === 'c_tn');
  assert.equal(tn.name, 'TN once', 'Client name must be updated to TN once');
  assert.equal(tn.billing.name, 'TN once Pvt Ltd', 'Billing name must be updated');
  assert.equal(context.data.receipts[0].clientName, 'TN once', 'Historical receipt clientName must be synced');
  assert.equal(context.lastToast, 'Client details updated');
  assert.equal(context.renderedCount, 1, 'render() must be called to update bottom tabs');
  console.log('✔ Test 2: Client renaming correctly updates c.name, billing, and linked receipts');
}

// Test 3: selectGroupRows functionality
{
  const { context } = setupClientContext();
  // Extract selectGroupRows
  const selectGroupRowsMatch = appJs.match(/function selectGroupRows\(kind, groupId\) \{[\s\S]*?\r?\n\}/);
  assert.ok(selectGroupRowsMatch, 'selectGroupRows function must be extractable');
  vm.runInNewContext(selectGroupRowsMatch[0], context);

  // Select group pg1
  context.selectGroupRows('project', 'pg1');
  assert.equal(context.selected.size, 3, 'Should select all 3 active rows in pg1');
  assert.ok(context.selected.has('it1'));
  assert.ok(context.selected.has('it2'));
  assert.ok(context.selected.has('it3'));

  // Toggle again: should deselect all 3
  context.selectGroupRows('project', 'pg1');
  assert.equal(context.selected.size, 0, 'Should deselect when all rows in group are already selected');

  // If another client's row was selected, selecting group should clear mismatch
  context.selected.add('it4'); // it4 belongs to c_fj
  assert.equal(context.selected.size, 1);
  context.selectGroupRows('project', 'pg1');
  assert.equal(context.selected.size, 3, 'Selection should switch cleanly to pg1');
  assert.ok(!context.selected.has('it4'), 'Previous client row must be cleared');
  console.log('✔ Test 3: selectGroupRows correctly selects, toggles, and handles cross-client transitions');
}

// Test 4: invoiceGroup and invoiceDialog ready rows checking
{
  const { context } = setupClientContext();
  let invoiceDialogOpened = false;
  context.invoiceDialog = () => { invoiceDialogOpened = true; };

  const start = appJs.indexOf('function invoiceGroup(kind, groupId) {');
  const end = appJs.indexOf('function ungroupDialog(kind, id) {', start);
  assert.ok(start !== -1 && end !== -1, 'invoiceGroup function must be extractable');
  vm.runInNewContext(appJs.slice(start, end), context);

  // In pg1: it1 is 'sent', it2 is 'paid', it3 is 'pending'
  context.invoiceGroup('project', 'pg1');
  assert.ok(invoiceDialogOpened, 'invoiceDialog must be opened for ready rows');
  assert.equal(context.selected.size, 2, 'Should select ready rows (sent & paid)');
  assert.ok(context.selected.has('it1'), 'Sent row it1 must be selected');
  assert.ok(context.selected.has('it2'), 'Paid row it2 must be selected');
  assert.ok(!context.selected.has('it3'), 'Pending row it3 must not be selected for invoice');

  // Now simulate all rows billed
  invoiceDialogOpened = false;
  context.data.invoices.push({ id: 'inv1', itemIds: ['it1', 'it2', 'it3'] });
  context.invoiceGroup('project', 'pg1');
  assert.ok(!invoiceDialogOpened, 'invoiceDialog must not open when all rows are already invoiced');
  assert.equal(context.lastToast, 'All rows in this group are already invoiced');

  console.log('✔ Test 4: invoiceGroup selects ready rows (sent/paid), skips pending, and prevents duplicate billing');
}

// Test 5: invoiceDialog accepts paid and sent rows
{
  const { context } = setupClientContext();
  context.today = () => '2026-11-11';
  context.currentClient = () => context.data.clients.find(c => c.id === context.activeClient);

  const start = appJs.indexOf('function invoiceDialog() {');
  const end = appJs.indexOf('function invoiceAdvance(i) {', start);
  assert.ok(start !== -1 && end !== -1, 'invoiceDialog function must be extractable');
  vm.runInNewContext(appJs.slice(start, end), context);

  // Select it1 (sent) and it2 (paid)
  context.selected.add('it1');
  context.selected.add('it2');
  context.invoiceDialog();

  assert.ok(context.lastModal, 'invoiceDialog should open successfully for sent and paid rows');
  assert.equal(context.lastModal.title, 'Create invoice');
  assert.ok(context.lastModal.body.includes('Stage Lights'), 'Breakup list should display Stage Lights');
  assert.ok(context.lastModal.body.includes('Trussing'), 'Breakup list should display Trussing');
  console.log('✔ Test 5: invoiceDialog accepts both sent and paid rows without error');
}

console.log('\nALL CLIENT RENAME AND GROUP INVOICING TESTS PASSED SUCCESSFULLY! 🎉📄✨');
