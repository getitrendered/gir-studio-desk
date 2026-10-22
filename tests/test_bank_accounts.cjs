const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const context = {
  crypto: require('node:crypto'),
  structuredClone: v => JSON.parse(JSON.stringify(v)),
  console,
  setTimeout,
  clearTimeout,
  setInterval: () => {},
  clearInterval: () => {},
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  window: {
    desk: {
      write: async () => true,
      read: async () => null,
      updates: { onChange: () => {}, state: async () => ({}) }
    }
  },
  document: {
    documentElement: { style: { setProperty: () => {} } },
    querySelectorAll: () => [],
    querySelector: () => ({
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      setProperty: () => {},
      innerHTML: '',
      style: {},
      addEventListener: () => {}
    }),
    addEventListener: () => {}
  },
  $: () => ({
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    setProperty: () => {},
    innerHTML: '',
    style: {},
    addEventListener: () => {}
  }),
  $$: () => [],
  requestAnimationFrame: cb => cb(),
  toast: () => {},
  closeModal: () => {},
  modal: () => {},
  save: () => {},
  render: () => {},
  mutate: (table, item) => {},
  clientItems: () => [],
  billedIds: () => new Set(),
  invoiceAdvance: () => 0
};

vm.createContext(context);
vm.runInContext(source, context);

// Populate test data inside the VM context
vm.runInContext(`
data.settings.seller = {
  name: 'GIR — Get It Rendered',
  address: 'Mumbai, India',
  email: 'studio@gir.com',
  phone: '9876543210',
  taxId: '',
  bankDetails: 'Bank: HDFC Bank\\nA/C No: 1234567890\\nIFSC: HDFC0001234',
  bankAccounts: [],
  activeBankAccountId: '',
  logoData: ''
};
data.clients = [{ id: 'c1', name: 'Acme Corp', billing: { name: 'Acme Corp' } }];
data.items = [
  { id: 'i1', clientId: 'c1', service: '3D Render', quantity: 1, rate: 5000, quotedTotal: 5000, advanceAmount: 0, status: 'sent' }
];
activeClient = 'c1';
`, context);

// Test 1: Backward-compatibility migration of legacy bankDetails
vm.runInContext('ensureBankAccounts()', context);
const seller = vm.runInContext('data.settings.seller', context);
assert.equal(seller.bankAccounts.length, 1, 'Legacy bankDetails should be migrated into 1 bank account');
assert.equal(seller.bankAccounts[0].label, 'Primary Account');
assert.equal(seller.activeBankAccountId, seller.bankAccounts[0].id);
assert.match(seller.bankDetails, /HDFC Bank/);
console.log('✓ Test 1: Legacy bank details migration passed');

// Test 2: formatBankDetails
const formatted = vm.runInContext(`
formatBankDetails({
  holderName: 'GIR Studio',
  bankName: 'ICICI Bank',
  accountNumber: '9988776655',
  ifsc: 'ICIC0009999',
  upiId: 'gir@icici'
})
`, context);
assert.match(formatted, /A\/C Holder: GIR Studio/);
assert.match(formatted, /Bank: ICICI Bank/);
assert.match(formatted, /A\/C No: 9988776655/);
assert.match(formatted, /IFSC: ICIC0009999/);
assert.match(formatted, /UPI ID: gir@icici/);
console.log('✓ Test 2: formatBankDetails helper passed');

// Test 3: Adding second bank account and switching active
vm.runInContext(`
data.settings.seller.bankAccounts.push({
  id: 'acc-icici-2',
  label: 'ICICI Current',
  holderName: 'GIR Studio Desk',
  bankName: 'ICICI Bank',
  accountNumber: '9988776655',
  ifsc: 'ICIC0009999',
  upiId: 'gir@icici',
  details: ''
});
setActiveBankAccount('acc-icici-2');
`, context);

const updatedSeller = vm.runInContext('data.settings.seller', context);
assert.equal(updatedSeller.activeBankAccountId, 'acc-icici-2');
assert.match(updatedSeller.bankDetails, /A\/C No: 9988776655/);
assert.match(updatedSeller.bankDetails, /ICIC0009999/);
console.log('✓ Test 3: Multi-bank account switching passed');

// Test 4: Creating invoice uses the active bank details
const invoiceHtml = vm.runInContext(`
const inv = {
  id: 'inv-test-1',
  clientId: 'c1',
  number: 'GIR-2026-0001',
  issueDate: '2026-10-23',
  itemIds: ['i1'],
  lines: [{ serial: 1, service: '3D Render', quantity: 1, rate: 5000, total: 5000 }],
  subtotal: 5000,
  discount: 0,
  finalAmount: 5000,
  advanceAmount: 0,
  status: 'issued',
  seller: structuredClone(data.settings.seller),
  buyer: { name: 'Acme Corp' }
};
invoiceHtml(inv);
`, context);
assert.match(invoiceHtml, /9988776655/);
console.log('✓ Test 4: Invoice creation includes active bank details passed');

// Test 5: Deleting an account re-assigns active if the deleted was active
vm.runInContext("deleteBankAccount('acc-icici-2')", context);
const sellerAfterDelete = vm.runInContext('data.settings.seller', context);
assert.equal(sellerAfterDelete.bankAccounts.length, 1);
assert.equal(sellerAfterDelete.activeBankAccountId, sellerAfterDelete.bankAccounts[0].id);
assert.match(sellerAfterDelete.bankDetails, /HDFC Bank/);
console.log('✓ Test 5: Bank account deletion and fallback passed');

// Test 6: renderBankAccountsList outputs HTML
const html = vm.runInContext('renderBankAccountsList()', context);
assert.match(html, /Primary Account/);
assert.match(html, /Active on invoices/);
assert.match(html, /data-set-active-bank/);
assert.match(html, /data-edit-bank/);
console.log('✓ Test 6: renderBankAccountsList UI rendering passed');

console.log('ALL BANK ACCOUNTS MANAGEMENT TESTS PASSED!');
