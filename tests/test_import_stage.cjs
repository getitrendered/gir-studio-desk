const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('function prepareImportPreview(');
const end = source.indexOf('async function migrateImport()', start);
assert(start >= 0 && end > start);
let nextId = 0;
const context = {
  uid: () => `id-${++nextId}`,
  data: { clients: [] },
  num: v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0,
  validDate: value => value || null
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const preview = vm.runInContext(`prepareImportPreview({
  fileHash: '${'a'.repeat(64)}', fileName: 'sample.xlsx', skippedSheets: [],
  clients: [{name:'Example',groups:[{sourceGroup:1,startRow:3,endRow:8,agreedAmount:5000,amountCell:'K8'}],
    items:[{sourceRow:3,serial:'1',date:'2024-08-15',service:'Posters',quantity:'3',rate:'300',total:'900',status:'paid',yellowGroup:1},
           {sourceRow:8,serial:'8',date:'2024-09-11',service:'Layout',quantity:'2',rate:'150',total:'300',status:'pending',yellowGroup:1}]}]
})`, context);
assert.equal(preview.clients[0].groups[0].agreedAmount, 5000);
assert.equal(preview.clients[0].groups[0].label, 'Rows 3–8');
assert.equal(preview.clients[0].items[0].groupId, preview.clients[0].items[1].groupId);
assert.equal(context.data.clients.length, 0, 'staging must not write to the ledger');
console.log('Import staging passed');
