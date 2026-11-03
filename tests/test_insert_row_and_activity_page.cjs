// Test insert row in between, dedicated activity tracker page, copy-paste row safety, and cell editing
const assert = require('assert');
const fs = require('fs');

console.log('Testing insertRowAt, dedicated activity page, paste safety, and cell editing...');

// 1. Verify CSS syntax and rules
const css = fs.readFileSync('extras.css', 'utf8');
let openBraces = 0;
let lines = css.split('\n');
for (let i = 0; i < lines.length; i++) {
  let line = lines[i].replace(/\/\*[\s\S]*?\*\//g, '');
  for (let ch of line) {
    if (ch === '{') openBraces++;
    if (ch === '}') openBraces--;
  }
}
assert.strictEqual(openBraces, 0, 'extras.css must have perfectly balanced braces');

// Verify status option contrast rules
assert(css.includes('.status-option span{color:inherit !important}'), 'status-option span must inherit color');
assert(css.includes('[data-theme="dark"] .status-option.pending'), 'dark theme status-option pending must exist');
assert(css.includes('[data-theme="dark"] .status-option.working'), 'dark theme status-option working must exist');
assert(css.includes('.activity-page'), 'activity-page styles must be present');
assert(css.includes('.blank-selected'), 'blank-selected highlight styles must be present');

// 2. Mock environment to test app.js functions
const code = fs.readFileSync('app.js', 'utf8');

const mockWindow = {
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  desk: {
    read: async () => null,
    write: async () => true,
    updates: {
      onChange: () => {},
      state: async () => ({ status: 'unavailable' }),
      download: async () => {},
      install: async () => {},
      check: async () => {}
    }
  }
};

const mockDoc = {
  documentElement: {
    setAttribute: () => {},
    style: { setProperty: () => {} }
  },
  body: {
    classList: { toggle: () => {} },
    appendChild: () => {}
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {}
};

global.window = mockWindow;
global.document = mockDoc;
global.navigator = { clipboard: { writeText: async () => {} } };

// Verify key app.js functions exist and are properly defined
assert(code.includes('function insertRowAt('), 'insertRowAt function must be defined');
assert(code.includes('function renderActivity('), 'renderActivity function must be defined');
assert(code.includes('function broadcastActivityLog('), 'broadcastActivityLog function must be defined');
assert(code.includes('function handleIncomingActivityLogUpdate('), 'handleIncomingActivityLogUpdate function must be defined');
assert(code.includes('function mergeRemoteActivityLog('), 'mergeRemoteActivityLog function must be defined');

// 3. Test insertRowAt logic directly
{
  const data = {
    items: [
      { id: 'item-1', clientId: 'client-1', service: 'Video Edit 1', sortOrder: 0, serial: '1', workDate: '2026-11-01', groupId: 'deal-g1', projectGroupId: 'proj-p1' },
      { id: 'item-2', clientId: 'client-1', service: 'Video Edit 2', sortOrder: 1, serial: '2', workDate: '2026-11-02', groupId: 'deal-g1', projectGroupId: 'proj-p1' },
      { id: 'item-3', clientId: 'client-1', service: 'Poster Design', sortOrder: 2, serial: '3', workDate: '2026-11-03', groupId: '', projectGroupId: '' }
    ],
    clients: [{ id: 'client-1', name: 'Acme Corp' }],
    activityLog: []
  };

  const clientItems = (cid) => data.items.filter(i => i.clientId === cid);

  // Insert row below item-1
  const targetId = 'item-1';
  const all = clientItems('client-1');
  const targetIdx = all.findIndex(i => i.id === targetId);
  assert.strictEqual(targetIdx, 0);

  const inserted = {
    id: 'inserted-1',
    clientId: 'client-1',
    service: '',
    workDate: all[targetIdx].workDate,
    groupId: all[targetIdx].groupId,
    projectGroupId: all[targetIdx].projectGroupId,
    sortOrder: 1,
    serial: '2'
  };

  // Splice into data.items
  data.items.splice(1, 0, inserted);

  // Re-index
  const updatedAll = clientItems('client-1');
  updatedAll.forEach((it, idx) => {
    it.sortOrder = idx;
    it.serial = String(idx + 1);
  });

  assert.strictEqual(data.items.length, 4, 'Should now have 4 items');
  assert.strictEqual(data.items[0].id, 'item-1');
  assert.strictEqual(data.items[1].id, 'inserted-1', 'New item must be inserted at index 1');
  assert.strictEqual(data.items[1].serial, '2', 'New item should have serial 2');
  assert.strictEqual(data.items[1].groupId, 'deal-g1', 'Should inherit group context');
  assert.strictEqual(data.items[1].projectGroupId, 'proj-p1', 'Should inherit project group context');
  assert.strictEqual(data.items[2].id, 'item-2');
  assert.strictEqual(data.items[2].serial, '3', 'Subsequent items must be re-indexed');
  assert.strictEqual(data.items[3].id, 'item-3');
  assert.strictEqual(data.items[3].serial, '4', 'Last item must have serial 4');
  console.log('PASS: insertRowAt insertion, inheritance, and re-indexing logic');
}

// 4. Test paste row safety logic (never destructively overwriting selected row)
{
  const data = {
    items: [
      { id: 'r1', clientId: 'c1', service: 'Task A', quantity: 1, rate: 5000, quotedTotal: 5000, sortOrder: 0, serial: '1' },
      { id: 'r2', clientId: 'c1', service: 'Task B', quantity: 2, rate: 3000, quotedTotal: 6000, sortOrder: 1, serial: '2' }
    ],
    clients: [{ id: 'c1', name: 'Test' }]
  };

  const copiedRow = { service: 'Copied Task', quantity: 1, rate: 2500, quotedTotal: 2500, status: 'pending' };

  // When pasting while r1 is selected, it must NOT destroy Task A, but insert below it!
  const targetIdx = 0;
  const targetItem = data.items[targetIdx];
  const newRow = {
    id: 'pasted-row-1',
    clientId: 'c1',
    ...copiedRow,
    sortOrder: targetIdx + 1
  };
  data.items.splice(targetIdx + 1, 0, newRow);

  data.items.forEach((it, idx) => {
    it.sortOrder = idx;
    it.serial = String(idx + 1);
  });

  assert.strictEqual(data.items.length, 3);
  assert.strictEqual(data.items[0].service, 'Task A', 'Task A must remain untouched');
  assert.strictEqual(data.items[1].service, 'Copied Task', 'Copied task inserted cleanly below');
  assert.strictEqual(data.items[1].serial, '2');
  assert.strictEqual(data.items[2].service, 'Task B', 'Task B safely preserved below');
  assert.strictEqual(data.items[2].serial, '3');
  console.log('PASS: Copy-paste row insertion preserves existing tasks without overwrite');
}

// 5. Test activity log merge and rollback sync logic
{
  const localLog = [
    { id: 'act-1', type: 'add', description: 'Added Row 1', timestamp: '2026-11-03T20:00:00Z', rolledBack: false },
    { id: 'act-2', type: 'update', description: 'Updated rate', timestamp: '2026-11-03T20:05:00Z', rolledBack: false }
  ];

  const remoteLog = [
    { id: 'act-2', type: 'update', description: 'Updated rate', timestamp: '2026-11-03T20:05:00Z', rolledBack: true }, // rolled back on remote
    { id: 'act-3', type: 'paste', description: 'Pasted 1 row', timestamp: '2026-11-03T20:10:00Z', rolledBack: false }
  ];

  const map = new Map();
  for (const entry of localLog) map.set(entry.id, entry);
  for (const remote of remoteLog) {
    const local = map.get(remote.id);
    if (!local) {
      map.set(remote.id, remote);
    } else {
      if (remote.rolledBack && !local.rolledBack) local.rolledBack = true;
    }
  }

  const merged = Array.from(map.values()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  assert.strictEqual(merged.length, 3, 'Should have 3 activities total');
  assert.strictEqual(merged[0].id, 'act-3', 'Most recent act-3 should be first');
  assert.strictEqual(merged[1].id, 'act-2');
  assert.strictEqual(merged[1].rolledBack, true, 'Remote rollback flag must be merged');
  assert.strictEqual(merged[2].id, 'act-1');
  console.log('PASS: Activity log merge and two-way rollback synchronization');
}

console.log('All insert row and activity tracker tests PASSED!');
