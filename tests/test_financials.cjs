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
    { id:'c', groupId:null, quotedTotal:2000, status:'pending' }
  ],
  invoices: [{ id:'inv', itemIds:['a'], finalAmount:4000, status:'paid' }]
}, num:v=>Number(v)||0, billedIds(){return new Set(this.data.invoices.flatMap(i=>i.itemIds));} };
vm.createContext(context);
vm.runInContext(source.slice(start,end).replace('const billed = billedIds()', 'const billed = new Set(data.invoices.flatMap(i=>i.itemIds))'), context);
const f = vm.runInContext('financials()', context);
assert.equal(f.revenue, 4000);
assert.equal(f.awaiting, 4500);
assert.equal(f.estimated, 2000);
assert.equal(f.quoted, 14000);
console.log('Financial rules passed');
