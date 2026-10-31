const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- TEST: Add Multiples to Worksheet (v0.2.57) ---');

const appPath = path.resolve(__dirname, '../app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

// 1. Verify toolbar markup and actions hook
assert(appCode.includes('data-action="add-multiples"'), 'Toolbar must include Add Multiples button');
assert(appCode.includes("if(action==='add-multiples')return addMultiplesDialog();"), 'actions() must route add-multiples');
assert(appCode.includes('contextAddMulti'), 'Row context menu must include Add Multiples option');
assert(appCode.includes('contextAddMultiBlank'), 'Blank row context menu must include Add Multiples option');
console.log('✓ UI and actions routing verified in app.js');

// 2. Extract and test parser functions
const cleanSerialMatch = appCode.match(/const cleanSerial\s*=\s*v\s*=>\s*\{[\s\S]*?\};/);
assert(cleanSerialMatch, 'cleanSerial must be in app.js');

const numMatch = appCode.match(/const num\s*=\s*v\s*=>[\s\S]*?;/);
assert(numMatch, 'num function must be in app.js');

const validDateMatch = appCode.match(/function validDate\(s\)\s*\{[\s\S]*?null;\s*\}/);
assert(validDateMatch, 'validDate function must be in app.js');

const getNextSerialMatch = appCode.match(/function getNextWorksheetSerial\([\s\S]*?\n\}/);
assert(getNextSerialMatch, 'getNextWorksheetSerial must be in app.js');

const parseLineMatch = appCode.match(/function parseMultiRowLine\([\s\S]*?\n\}/);
assert(parseLineMatch, 'parseMultiRowLine must be in app.js');

const parseTextMatch = appCode.match(/function parseMultiRowText\([\s\S]*?\n\}/);
assert(parseTextMatch, 'parseMultiRowText must be in app.js');

// Evaluate functions in sandbox
const sandbox = {
  activeClient: 'c1',
  data: {
    items: [],
    clients: [{ id: 'c1', name: 'Test Client' }],
    groups: [],
    settings: { seller: {} }
  },
  clientItems: (id) => sandbox.data.items.filter(i => i.clientId === (id || sandbox.activeClient)).sort((a,b) => a.sortOrder - b.sortOrder),
  today: () => '2026-10-31'
};

const fnModule = new Function('sandbox', `
  with(sandbox) {
    ${cleanSerialMatch[0]}
    ${numMatch[0]}
    ${validDateMatch[0]}
    ${getNextSerialMatch[0]}
    ${parseLineMatch[0]}
    ${parseTextMatch[0]}
    return { cleanSerial, num, validDate, getNextWorksheetSerial, parseMultiRowLine, parseMultiRowText };
  }
`);

const { cleanSerial, num, validDate, getNextWorksheetSerial, parseMultiRowLine, parseMultiRowText } = fnModule(sandbox);

// 3. Test parseMultiRowLine with real WhatsApp inputs
console.log('Testing WhatsApp and text patterns...');

// Pattern A: Qty x Rate
const p1 = parseMultiRowLine('LINE DRAWING - HALDI BALLROOM ENTRANCE ARCH 1 × 300', 30, '2026-10-31');
assert.strictEqual(p1.service, 'LINE DRAWING - HALDI BALLROOM ENTRANCE ARCH');
assert.strictEqual(p1.quantity, 1);
assert.strictEqual(p1.rate, 300);
assert.strictEqual(p1.quotedTotal, 300);
assert.strictEqual(p1.serial, '30');

const p2 = parseMultiRowLine('HALDI - FLOOR FLEX 2 × 400', 31, '2026-10-31');
assert.strictEqual(p2.service, 'HALDI - FLOOR FLEX');
assert.strictEqual(p2.quantity, 2);
assert.strictEqual(p2.rate, 400);
assert.strictEqual(p2.quotedTotal, 800);

const p3 = parseMultiRowLine('3D CARNIVAL 1 × 13,500', 32, '2026-10-31');
assert.strictEqual(p3.service, '3D CARNIVAL');
assert.strictEqual(p3.quantity, 1);
assert.strictEqual(p3.rate, 13500);
assert.strictEqual(p3.quotedTotal, 13500);

// Pattern B: Numbered list item + bracket remarks
const p4 = parseMultiRowLine('1. 3D Floor Plan - 2 x 4000 (approved by client)', 33, '2026-10-31');
assert.strictEqual(p4.service, '3D Floor Plan');
assert.strictEqual(p4.quantity, 2);
assert.strictEqual(p4.rate, 4000);
assert.strictEqual(p4.quotedTotal, 8000);
assert.strictEqual(p4.remarks, 'approved by client');

// Pattern C: Single amount with /-
const p5 = parseMultiRowLine('Mandap Setup - 12000/-', 34, '2026-10-31');
assert.strictEqual(p5.service, 'Mandap Setup');
assert.strictEqual(p5.quantity, 1);
assert.strictEqual(p5.rate, 12000);
assert.strictEqual(p5.quotedTotal, 12000);

// Pattern D: Single amount plain
const p6 = parseMultiRowLine('Stage Design 5000', 35, '2026-10-31');
assert.strictEqual(p6.service, 'Stage Design');
assert.strictEqual(p6.rate, 5000);
assert.strictEqual(p6.quotedTotal, 5000);

// Pattern E: Plain service with remarks only
const p7 = parseMultiRowLine('Passage Decor (night render)', 36, '2026-10-31');
assert.strictEqual(p7.service, 'Passage Decor');
assert.strictEqual(p7.remarks, 'night render');
assert.strictEqual(p7.rate, 0);

// Pattern F: TSV
const p8 = parseMultiRowLine('Grand Entry\t2\t1500\t3000\tsent\turgent', 37, '2026-10-31');
assert.strictEqual(p8.service, 'Grand Entry');
assert.strictEqual(p8.quantity, 2);
assert.strictEqual(p8.rate, 1500);
assert.strictEqual(p8.quotedTotal, 3000);
assert.strictEqual(p8.status, 'sent');
assert.strictEqual(p8.remarks, 'urgent');

console.log('✓ parseMultiRowLine handles all natural formats correctly');

// 4. Test multi-line text parsing
const multiText = `
LINE DRAWING - HALDI BALLROOM ENTRANCE ARCH 1 × 300
HALDI - FLOOR FLEX 2 × 400
HALDI - INSIDE CONSOLE 2 × 400
HALDI - SIGNAGE 3 × 100
3D CARNIVAL 1 × 13,500
LINE DRAWING - HALDI BACKDROP WINDOW 1 × 300
1. 3D Floor Plan - 2 x 4000 (approved)
2) Stage Design 5000
Mandap Setup - 12000/-
Passage Decor (night render)
`;

const parsedRows = parseMultiRowText(multiText, 30, '2026-10-31', 'pending');
assert.strictEqual(parsedRows.length, 10, 'Must parse exactly 10 lines');
assert.strictEqual(parsedRows[0].serial, '30');
assert.strictEqual(parsedRows[1].serial, '31');
assert.strictEqual(parsedRows[9].serial, '39');
console.log('✓ parseMultiRowText sequential serial numbering verified (30..39)');

// 5. Test sequential continuation with getNextWorksheetSerial
sandbox.data.items = [];
assert.strictEqual(getNextWorksheetSerial('c1'), 1, 'Empty sheet starts at 1');

// Add 10 items (serials 1..10)
for (let i = 1; i <= 10; i++) {
  sandbox.data.items.push({ id: 'i' + i, clientId: 'c1', serial: String(i), sortOrder: i - 1 });
}
assert.strictEqual(getNextWorksheetSerial('c1'), 11, 'Next serial after 10 items is 11');

// Suppose items run from 20 to 29 (like user specifically described!)
sandbox.data.items = [];
for (let i = 20; i <= 29; i++) {
  sandbox.data.items.push({ id: 'i' + i, clientId: 'c1', serial: String(i), sortOrder: i - 20 });
}
assert.strictEqual(getNextWorksheetSerial('c1'), 30, 'After items 20..29, continuation starts at 30!');
console.log('✓ Sequential continuation formula verified (20..29 -> 30)');

console.log('ALL ADD MULTIPLES TESTS PASSED SUCCESSFULLY!');
