const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('Testing Dashboard Notice Board & Upcoming Meetings Gist...');

function setupTestEnvironment() {
  const appJsPath = path.join(__dirname, '..', 'app.js');
  const extrasCssPath = path.join(__dirname, '..', 'extras.css');

  const appJs = fs.readFileSync(appJsPath, 'utf8');
  const extrasCss = fs.readFileSync(extrasCssPath, 'utf8');

  const context = {
    console,
    data: {
      clients: [
        { id: 'c1', name: 'Ashwa Events' },
        { id: 'c2', name: 'Purple Tree' }
      ],
      projectGroups: [],
      groups: [],
      items: [
        { id: 'i1', clientId: 'c1', service: 'Floor plan', quantity: 1, rate: 5000, quotedTotal: 5000, status: 'sent' }
      ],
      tasks: [],
      invoices: [],
      receipts: [],
      settings: {
        theme: 'light',
        displayName: 'Samuel',
        zoom: 100
      }
    },
    tab: 'dashboard',
    activeClient: 'c1',
    financials: () => ({
      awaiting: 5000,
      revenue: 12000,
      sentItems: [],
      outstandingItems: [{ clientId: 'c1', balance: 5000, itemIds: ['i1'] }]
    }),
    counts: () => ({
      total: 1,
      done: 1,
      working: 0,
      pending: 0,
      overdue: 0
    }),
    clientItems: () => context.data.items,
    unfinishedCount: () => 0,
    money: n => '₹' + Number(n || 0).toLocaleString('en-IN'),
    num: v => Number(v) || 0,
    esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])),
    today: () => '2026-11-05',
    currentUserId: () => 'user-1',
    closeStatusMenu: () => {},
    applyTheme: () => {},
    $: () => null,
    $$: () => [],
    authLoading: false,
    session: { user: { id: 'user-1' } },
    workspaceReady: true,
    GIR_WORKSPACE_ID: '17f39873-e10f-4bdf-93ee-1f92b3e25251'
  };

  vm.createContext(context);

  const take = (start, end) => appJs.slice(appJs.indexOf(start), appJs.indexOf(end, appJs.indexOf(start)));

  const code =
    take('function getTaskCategory(', 'function formatTaskDateTime(') +
    take('function formatTaskDateTime(', 'function formatTaskCountdown(') +
    take('function formatTaskCountdown(', 'function recordDeletedTaskIds(') +
    take('function updateLiveTaskCountdowns()', 'function renderTasks()') +
    take('function renderDashboard()', 'function groupTotalValue(');

  vm.runInContext(code, context);

  return { context, extrasCss, appJs };
}

// Test 1: Empty state when no notices/meetings exist
{
  const { context } = setupTestEnvironment();
  const html = context.renderDashboard();
  assert(html.includes('dashboard-notice-panel'), 'Must render dashboard-notice-panel');
  assert(html.includes('Notice Board &amp; Upcoming Meetings') || html.includes('Notice Board & Upcoming Meetings'), 'Must render Notice Board title');
  assert(html.includes('dashboard-notice-empty'), 'Must render empty state container when no active tasks exist');
  assert(html.includes('Notice Board is all clear'), 'Empty state must show friendly message');
  assert(html.includes('data-dashboard-add-task'), 'Must provide + Add Notice / Meeting button');
  console.log('✓ Test 1: Dashboard renders clean empty state when no notices exist');
}

// Test 2: Active meetings and notices rendered with date, timer, and actions
{
  const { context } = setupTestEnvironment();

  // Set up 3 tasks: Overdue, Trending (< 30 min), and Upcoming Meeting (Wednesday 11th)
  const now = Date.now();
  context.data.tasks = [
    {
      id: 'task-meeting-wed',
      title: 'Purple Tree Event Setup Meeting',
      description: 'Discuss 3D renders and mandap walkthrough with client',
      remindAt: new Date(now + 6 * 24 * 3600 * 1000).toISOString(), // ~6 days ahead (Wednesday)
      completed: false,
      createdBy: 'Samuel'
    },
    {
      id: 'task-urgent-focus',
      title: 'Review revisions for Ashwa Gala',
      description: 'Check final lighting layout',
      remindAt: new Date(now + 15 * 60 * 1000).toISOString(), // 15 mins ahead (Focus / Trending)
      completed: false,
      createdBy: 'Mezrid'
    },
    {
      id: 'task-overdue-call',
      title: 'Urgent payment confirmation call',
      description: 'Call accounting team for wire receipt',
      remindAt: new Date(now - 45 * 60 * 1000).toISOString(), // 45 mins ago (Overdue)
      completed: false,
      createdBy: 'Samuel'
    }
  ];

  const html = context.renderDashboard();

  // Header badges
  assert(html.includes('🚨 1 Overdue'), 'Must show overdue count badge');
  assert(html.includes('⚡ 1 In Focus'), 'Must show in-focus count badge');
  assert(html.includes('Open Notice Board (3) →'), 'Header button must link to Notice Board with total count');

  // Overdue card
  assert(html.includes('Urgent payment confirmation call'), 'Must display overdue task title');
  assert(html.includes('🚨 OVERDUE'), 'Must display OVERDUE pill');
  assert(html.includes('timer-overdue'), 'Timer must have timer-overdue class');

  // Focus / Trending card
  assert(html.includes('Review revisions for Ashwa Gala'), 'Must display trending task title');
  assert(html.includes('⚡ IN FOCUS'), 'Must display IN FOCUS pill');
  assert(html.includes('timer-active'), 'Timer must have timer-active class');

  // Upcoming Meeting card (Wednesday)
  assert(html.includes('Purple Tree Event Setup Meeting'), 'Must display upcoming meeting title');
  assert(html.includes('Discuss 3D renders and mandap walkthrough'), 'Must display meeting description');
  assert(html.includes('timer-upcoming'), 'Timer must have timer-upcoming class');
  assert(html.includes('data-remind-at='), 'Must have data-remind-at attribute for live countdown ticking');

  // Action buttons on cards
  assert(html.includes('data-task-action="complete" data-task-id="task-meeting-wed"'), 'Cards must have complete action');
  assert(html.includes('data-task-jump="task-meeting-wed"'), 'Cards must have jump action to notice board');

  console.log('✓ Test 2: Active meetings and notices rendered with date, timer, and action buttons');
}

// Test 3: updateLiveTaskCountdowns supports dashboard tab
{
  const { appJs } = setupTestEnvironment();
  assert(appJs.includes("if (tab !== 'tasks' && tab !== 'dashboard') return;"), 'updateLiveTaskCountdowns must update live timers when tab is dashboard');
  console.log('✓ Test 3: updateLiveTaskCountdowns verified to update timers on the Dashboard');
}

// Test 4: extras.css styling for dashboard notice panel
{
  const { extrasCss } = setupTestEnvironment();
  assert(extrasCss.includes('.panel.highlight-panel-notice'), 'extras.css must include .highlight-panel-notice styles');
  assert(extrasCss.includes('.dashboard-notice-card'), 'extras.css must include .dashboard-notice-card styles');
  assert(extrasCss.includes('.dashboard-timer'), 'extras.css must include .dashboard-timer countdown styles');
  assert(extrasCss.includes('.dashboard-notice-empty'), 'extras.css must include .dashboard-notice-empty styles');
  console.log('✓ Test 4: CSS rules verified for dashboard notice board and live timers');
}

console.log('\nALL DASHBOARD NOTICE BOARD TESTS PASSED SUCCESSFULLY! 🎉');
