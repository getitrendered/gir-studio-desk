const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setupTestEnvironment() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const extrasCss = fs.readFileSync(path.join(__dirname, '..', 'extras.css'), 'utf8');

  const elements = {};
  const queryAll = selector => [];

  const context = {
    console,
    Date,
    Math,
    String,
    Number,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    JSON,
    structuredClone: obj => JSON.parse(JSON.stringify(obj)),
    document: {
      querySelector: sel => elements[sel] || null,
      querySelectorAll: queryAll,
      getElementById: id => elements['#' + id] || null,
      createElement: tag => ({
        tagName: tag.toUpperCase(),
        classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
        setAttribute: () => {},
        style: {},
        appendChild: () => {},
        addEventListener: () => {},
        remove: () => {}
      }),
      body: { classList: { add: () => {}, remove: () => {} } },
      activeElement: null
    },
    window: {
      desk: { read: async () => null, write: async () => {} }
    },
    $: sel => elements[sel] || null,
    $$: queryAll,
    data: {
      clients: [
        { id: 'c1', name: 'Grand Weddings', billing: { name: 'Grand Weddings' }, sortOrder: 0 },
        { id: 'c2', name: 'Corporate Events Inc', billing: { name: 'Corporate Events Inc' }, sortOrder: 1 }
      ],
      projectGroups: [
        { id: 'p1', clientId: 'c1', label: 'Wedding Mandap & Stage' }
      ],
      groups: [
        { id: 'g1', clientId: 'c2', label: 'Annual Gala Deal', agreedAmount: 50000 }
      ],
      items: [
        // Group p1: 4 items (2 paid, 1 working, 1 pending) -> remaining = 2, completed = 2 (50%)
        { id: 'i1', clientId: 'c1', projectGroupId: 'p1', groupId: null, service: 'Mandap 3D', quantity: 1, rate: 10000, quotedTotal: 10000, advanceAmount: 0, status: 'paid', sortOrder: 0 },
        { id: 'i2', clientId: 'c1', projectGroupId: 'p1', groupId: null, service: 'Entry Arch', quantity: 1, rate: 5000, quotedTotal: 5000, advanceAmount: 0, status: 'paid', sortOrder: 1 },
        { id: 'i3', clientId: 'c1', projectGroupId: 'p1', groupId: null, service: 'Stage Backdrop', quantity: 1, rate: 8000, quotedTotal: 8000, advanceAmount: 0, status: 'working', sortOrder: 2 },
        { id: 'i4', clientId: 'c1', projectGroupId: 'p1', groupId: null, service: 'Photobooth', quantity: 1, rate: 4000, quotedTotal: 4000, advanceAmount: 0, status: 'pending', sortOrder: 3 },
        // Standalone row in c1
        { id: 'i5', clientId: 'c1', projectGroupId: null, groupId: null, service: 'Standee', quantity: 1, rate: 1500, quotedTotal: 1500, advanceAmount: 0, status: 'pending', sortOrder: 4 },
        // Group g1: 2 items (both paid) -> remaining = 0, completed = 2 (100% - Paid in full)
        { id: 'i6', clientId: 'c2', projectGroupId: null, groupId: 'g1', service: 'Keynote Backdrop', quantity: 1, rate: 30000, quotedTotal: 30000, advanceAmount: 0, status: 'paid', sortOrder: 0 },
        { id: 'i7', clientId: 'c2', projectGroupId: null, groupId: 'g1', service: 'Registration Desk', quantity: 1, rate: 20000, quotedTotal: 20000, advanceAmount: 0, status: 'paid', sortOrder: 1 }
      ],
      receipts: [],
      pending: [],
      pendingDeletes: [],
      members: [],
      settings: { workspaceId: 'ws-test', displayName: 'Samuel', localPartner: 'Mezrid' }
    },
    tab: 'goals',
    activeClient: 'c1',
    selected: new Set(),
    collapsedGroups: new Set(),
    rowClipboard: { mode: 'copy', items: [], sourceRowIds: [] },
    undoStack: [],
    redoStack: [],
    goalFilter: 'active',
    goalSearchQuery: '',
    money: n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }),
    num: v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0,
    esc: v => String(v ?? ''),
    cleanSerial: v => String(v || ''),
    today: () => '2026-11-05',
    currentUserId: () => 'user-samuel',
    uid: (() => { let n = 100; return () => `uid-${++n}`; })(),
    pushUndo: action => context.undoStack.push({ action }),
    toast: () => {},
    enqueue: () => {},
    save: () => {},
    scheduleSync: () => {},
    render: () => {},
    clientItems: (cid = 'c1') => context.data.items.filter(i => i.clientId === cid).sort((a,b) => a.sortOrder - b.sortOrder),
    groupedSheetItems: items => items || [],
    newItem: (cid, order) => ({
      id: `new-${order}-${Date.now()}`,
      clientId: cid,
      groupId: null,
      projectGroupId: null,
      service: '',
      quantity: 1,
      rate: 0,
      quotedTotal: 0,
      status: 'pending',
      advanceAmount: 0,
      sortOrder: order,
      serial: String(order + 1)
    }),
    consolidateAllReceipts: () => {}
  };

  vm.createContext(context);

  const take = (start, end) => appJs.slice(appJs.indexOf(start), appJs.indexOf(end, appJs.indexOf(start)));

  const code = 
    take('function groupTotalValue(', 'function groupHeader(') +
    take('function groupHeader(', 'function groupStatus(') +
    take('function groupStatus(', 'function blankRowHtml(') +
    take('function renderGroups()', 'function renderGoals()') +
    take('function renderGoals()', 'function renderClientDetails()') +
    take('function pasteCopiedRows(', 'function duplicateSelectedRow(');

  vm.runInContext(code, context);

  return { context, html, extrasCss };
}

console.log('Testing Goals Dashboard, Paid Group Badges, Chat Self Badge Removal, and Paste Safety...');

// Test 1: Navigation tab exists in index.html
{
  const { html } = setupTestEnvironment();
  assert(html.includes('<button data-tab="goals">Goals</button>'), 'index.html must include Goals navigation button');
  console.log('✓ Test 1: Goals tab button exists in index.html');
}

// Test 2: Goals dashboard calculations and SVG progress ring
{
  const { context } = setupTestEnvironment();
  const goalsHtml = context.renderGoals();

  // Hero card targets
  assert(goalsHtml.includes('Remaining Work Target'), 'Must include Remaining Work Target hero metric');
  assert(goalsHtml.includes('2</span>'), 'Must show 2 remaining tasks across active groups (from p1)');
  assert(goalsHtml.includes('Completed Tasks'), 'Must include Completed Tasks metric');
  assert(goalsHtml.includes('Active Groups'), 'Must include Active Groups metric');
  assert(goalsHtml.includes('Overall Completion'), 'Must include Overall Completion metric');

  // Group card for p1 (Wedding Mandap & Stage)
  assert(goalsHtml.includes('Wedding Mandap &amp; Stage') || goalsHtml.includes('Wedding Mandap & Stage'), 'Must show p1 title');
  assert(goalsHtml.includes('50% done'), 'p1 must show 50% done (2/4 complete)');
  assert(goalsHtml.includes('goal-ring-svg'), 'Must render SVG progress ring');
  assert(goalsHtml.includes('class="goal-ring-num">2</span>'), 'Must render remaining count 2 inside circle');
  assert(goalsHtml.includes('⚡ View Pending (2)'), 'Must render View Pending button with remaining count');
  assert(goalsHtml.includes('View in Sheet →'), 'Must render View in Sheet button');

  // Stat chips breakdown
  assert(goalsHtml.includes('⏳ 1 pending'), 'Must break down pending count');
  assert(goalsHtml.includes('🔨 1 working'), 'Must break down working count');
  assert(goalsHtml.includes('💰 2 paid'), 'Must break down paid count');

  console.log('✓ Test 2: Goals dashboard renders accurate metrics, circular SVG rings, and remaining task targets');
}

// Test 3: Goals filter modes (Active, All, Completed)
{
  const { context } = setupTestEnvironment();

  // Active filter (default): shows p1 (2 remaining), hides g1 (0 remaining)
  context.goalFilter = 'active';
  let html = context.renderGoals();
  assert(html.includes('Wedding Mandap'), 'Active filter must include p1 with remaining work');
  assert(!html.includes('Annual Gala Deal'), 'Active filter must exclude completed group g1');

  // Completed filter: shows g1, hides p1
  context.goalFilter = 'completed';
  html = context.renderGoals();
  assert(html.includes('Annual Gala Deal'), 'Completed filter must include g1');
  assert(!html.includes('Wedding Mandap'), 'Completed filter must exclude in-progress group p1');

  // All filter: shows both
  context.goalFilter = 'all';
  html = context.renderGoals();
  assert(html.includes('Wedding Mandap'), 'All filter must include p1');
  assert(html.includes('Annual Gala Deal'), 'All filter must include g1');

  console.log('✓ Test 3: Goal filters (Active / Completed / All) correctly categorize groups');
}

// Test 4: Paid Group Badge & Button Cleanup in renderGroups() and groupHeader()
{
  const { context } = setupTestEnvironment();
  context.goalFilter = 'all';

  // renderGroups for g1 (which is 100% paid)
  const groupsHtml = context.renderGroups();
  assert(groupsHtml.includes('group-paid-seal'), 'Must render prominent PAID IN FULL seal on paid group');
  assert(groupsHtml.includes('Paid in full'), 'Seal must contain text "Paid in full"');
  assert(groupsHtml.includes('is-paid-group'), 'Paid group card must have is-paid-group class');

  // In paid group g1, verify Mark Sent, Mark Paid, and Group Deal buttons are absent!
  const g1Html = groupsHtml.slice(groupsHtml.indexOf('Annual Gala Deal'));
  assert(!g1Html.includes('data-group-status="deal:g1:sent"'), 'Paid group card must NOT have Mark Sent button');
  assert(!g1Html.includes('data-group-status="deal:g1:paid"'), 'Paid group card must NOT have Mark Paid button');
  assert(!g1Html.includes('data-group-deal-card="deal:g1"'), 'Paid group card must NOT have Group Deal button');
  assert(g1Html.includes('data-group-paid-date="deal:g1"'), 'Paid group card must retain Paid Date button');

  // groupHeader for g1 in worksheet
  const g1Group = context.data.groups[0];
  const g1Items = context.data.items.filter(i => i.groupId === 'g1');
  const headerHtml = context.groupHeader('deal', g1Group, g1Items);
  assert(headerHtml.includes('group-paid-seal'), 'Worksheet header must show prominent Paid in full seal');
  assert(!headerHtml.includes('data-group-deal="deal:g1"'), 'Worksheet header must omit Group Deal button when paid');
  assert(!headerHtml.includes('data-group-status="deal:g1:sent"'), 'Worksheet header must omit Mark Sent button when paid');
  assert(!headerHtml.includes('data-group-status="deal:g1:paid"'), 'Worksheet header must omit Mark Paid button when paid');
  assert(headerHtml.includes('data-group-paid-date="deal:g1"'), 'Worksheet header must retain Paid Date button');

  console.log('✓ Test 4: Paid group displays prominent Paid in full seal and cleans redundant action buttons');
}

// Test 5: Paste Safety: pasting onto an empty row NEVER overwrites existing rows
{
  const { context } = setupTestEnvironment();

  // Mock clipboard with a copied row
  context.rowClipboard = {
    mode: 'copy',
    items: [
      { service: 'Sangeet board 5x3 ft', quantity: 1, rate: 3500, quotedTotal: 3500, status: 'pending' }
    ],
    sourceRowIds: ['i3']
  };

  const initialRowCount = context.data.items.length;
  const targetRow = context.data.items.find(i => i.id === 'i3');
  const targetServiceBefore = targetRow.service;

  // Paste on an empty / blank row (with tab set to sheet)
  context.tab = 'sheet';
  context.pasteCopiedRows(null, 0);

  // 1. Existing rows like i3 MUST NOT be overwritten!
  assert.equal(targetRow.service, targetServiceBefore, 'Target row must NOT be modified or destroyed!');

  // 2. A new row must be created and appended
  assert.equal(context.data.items.length, initialRowCount + 1, 'Pasting must insert a new row, increasing row count by 1');
  const insertedRow = context.data.items[context.data.items.length - 1];
  assert(insertedRow, 'Newly inserted row must exist with copied content');
  assert.equal(insertedRow.service, 'Sangeet board 5x3 ft', 'Inserted row must have copied service');
  assert.notEqual(insertedRow.id, 'i3', 'Inserted row must have a distinct unique id');

  // 3. Undo stack has the operation
  assert.equal(context.undoStack[context.undoStack.length - 1].action, 'Paste rows', 'Paste operation must be pushed to undo stack');

  console.log('✓ Test 5: pasteCopiedRows safely creates new row on empty row and NEVER overwrites existing tasks');
}

// Test 6: extras.css styling for pointer-events and goals
{
  const { extrasCss } = setupTestEnvironment();
  assert(extrasCss.includes('.sheet input[readonly]{pointer-events:auto;cursor:cell}'), 'Readonly inputs must have pointer-events:auto so clicking activates editing instantly');
  assert(extrasCss.includes('.goals-page'), 'extras.css must include .goals-page styles');
  assert(extrasCss.includes('.goal-ring-bar'), 'extras.css must include .goal-ring-bar progress circle styles');
  assert(extrasCss.includes('.group-paid-seal'), 'extras.css must include .group-paid-seal styles');
  assert(extrasCss.includes('.group-card-top-actions'), 'extras.css must include .group-card-top-actions styles');
  assert(extrasCss.includes('.group-card-ungroup'), 'extras.css must include .group-card-ungroup styles');
  console.log('✓ Test 6: CSS rules verified for pointer-events:auto, goals dashboard, and paid seals');
}

// Test 7: Group card top actions & paid seal separation (Zero Overlap)
{
  const { context } = setupTestEnvironment();
  const groupsHtml = context.renderGroups();
  assert(groupsHtml.includes('class="group-card-top-actions"'), 'Must render .group-card-top-actions flex container');
  assert(groupsHtml.includes('data-rename-card='), 'Must include rename button');
  assert(groupsHtml.includes('data-ungroup-card='), 'Must include ungroup button');
  assert(groupsHtml.includes('class="group-card-top-row"'), 'Must include .group-card-top-row');
  console.log('✓ Test 7: Group card top-right buttons and paid seal structured without overlap');
}

console.log('\nALL GOALS, PAID SEALS, AND SAFETY FIX TESTS PASSED! 🎉');
