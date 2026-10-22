const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('function financials()');
const end = source.indexOf('function counts()', start);
const context = { data: {
  groups: [{ id:'g1', agreedAmount:9000 }],
  items: [
    { id:'a', groupId:'g1', quotedTotal:6000, status:'paid' },
    { id:'b', groupId:'g1', quotedTotal:6000, status:'sent' },
    { id:'c', groupId:null, quotedTotal:2000, status:'pending', advanceAmount:300 },
    { id:'d', groupId:null, quotedTotal:5000, status:'discarded', advanceAmount:100 }
  ],
  invoices: [{ id:'inv', itemIds:['a'], finalAmount:4000, status:'paid' }]
}, num:v=>Number(v)||0, billedIds(){return new Set(this.data.invoices.flatMap(i=>i.itemIds));} };
context.invoiceAdvance = inv => inv.advanceAmount ?? inv.itemIds.reduce((sum,id)=>sum+(context.data.items.find(i=>i.id===id)?.advanceAmount||0),0);
vm.createContext(context);
vm.runInContext(source.slice(start,end).replace('const billed = billedIds()', 'const billed = new Set(data.invoices.flatMap(i=>i.itemIds))'), context);
const f = vm.runInContext('financials()', context);
assert.equal(f.revenue, 4300);
assert.equal(f.awaiting, 4500);
assert.equal(f.estimated, 6200);
assert.equal(f.quoted, 14000);
assert.equal(f.advances, 300);
assert.equal(f.discarded, 5000);
assert.equal(f.closed, 4000);
assert.equal(f.openAdvances, 300);
context.data.invoices.push({id:'issued',itemIds:['c'],finalAmount:1800,status:'issued',issueDate:'2026-10-21'});
const issued = vm.runInContext('financials()', context);
assert.equal(issued.revenue, 4300, 'issued invoice advance is received once');
assert.equal(issued.awaiting, 6000, 'issued invoice due deducts advance');
assert.equal(issued.estimated, 6000, 'estimated incoming includes all unpaid active work');
assert.equal(issued.months['Date unknown'].advances, 300, 'invoice date is not a receipt date');
context.data.items.push({id:'future',quotedTotal:700,status:'paid',workDate:'2026-12-15',paidAt:null});
const future=vm.runInContext('financials()',context);
assert.equal(future.months['2026-12'],undefined,'future work date must not become a payment month');
assert.equal(future.months['Date unknown'].received,5000);
console.log('Financial rules passed');
