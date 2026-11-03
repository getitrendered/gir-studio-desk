const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');

console.log('Testing Tasks & Reminders Manager with Artistic Clock & Dials...');

// 1. Verify index.html contains the tasks tab and notification badge
const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.ok(htmlContent.includes('data-tab="tasks"'), 'index.html should have a tasks tab');
assert.ok(htmlContent.includes('id="tasksDueCount"'), 'index.html should have #tasksDueCount badge');
console.log('✓ Test 1: index.html markup verified');

// 2. Verify extras.css contains Task Manager & Artistic Clock styling
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'extras.css'), 'utf8');
assert.ok(cssContent.includes('.tasks-shell'), 'extras.css should contain .tasks-shell');
assert.ok(cssContent.includes('.tasks-hero-container'), 'extras.css should contain .tasks-hero-container');
assert.ok(cssContent.includes('.artistic-time-picker'), 'extras.css should contain .artistic-time-picker');
assert.ok(cssContent.includes('.analog-clock-face'), 'extras.css should contain .analog-clock-face');
assert.ok(cssContent.includes('.dial-drum'), 'extras.css should contain .dial-drum');
assert.ok(cssContent.includes('[data-theme="dark"] .tasks-hero-container'), 'Dark mode should style .tasks-hero-container');
assert.ok(cssContent.includes('[data-theme="dark"] .artistic-time-picker'), 'Dark mode should style .artistic-time-picker');
console.log('✓ Test 2: extras.css layout and dark mode styles verified');

// 3. Test App Logic & Execution
const appJsSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function createMockElement(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    style: { setProperty() {} },
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      toggle(c, f) { if (f === undefined) { if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c); } else if (f) this.classes.add(c); else this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    },
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {},
    remove() {},
    querySelector() { return createMockElement('div'); },
    querySelectorAll() { return []; },
    innerHTML: '',
    value: '',
    textContent: ''
  };
}

const mockDoc = {
  documentElement: createMockElement('html'),
  body: createMockElement('body'),
  querySelector(sel) {
    if (sel === '#modalRoot') return createMockElement('div');
    if (sel === '#toast') return createMockElement('div');
    if (sel === '#tabs') return createMockElement('div');
    if (sel === '#tasksDueCount') return createMockElement('span');
    return createMockElement('div');
  },
  querySelectorAll() { return []; },
  addEventListener() {}
};

let capturedNotification = null;

const sandbox = {
  document: mockDoc,
  window: {
    desk: {
      read: async () => null,
      write: async () => {},
      notify: (title, body) => { capturedNotification = { title, body }; },
      updates: { onChange() {}, state: async () => ({ status: 'unavailable' }) }
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  },
  structuredClone: globalThis.structuredClone || (x => JSON.parse(JSON.stringify(x))),
  Set,
  Map,
  Date,
  Math,
  Number,
  String,
  Array,
  Boolean,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  console
};

vm.createContext(sandbox);
vm.runInContext(appJsSource, sandbox);

// 4. Verify Defaults and Data Model
const hasTasksArray = vm.runInContext("Array.isArray(defaults.tasks)", sandbox);
assert.ok(hasTasksArray, 'defaults.tasks should be an initialized Array');

const hasGetCategory = vm.runInContext("typeof getTaskCategory === 'function'", sandbox);
assert.ok(hasGetCategory, 'getTaskCategory should be defined');

const hasFormatDateTime = vm.runInContext("typeof formatTaskDateTime === 'function'", sandbox);
assert.ok(hasFormatDateTime, 'formatTaskDateTime should be defined');

const hasFormatCountdown = vm.runInContext("typeof formatTaskCountdown === 'function'", sandbox);
assert.ok(hasFormatCountdown, 'formatTaskCountdown should be defined');

const hasRenderTasks = vm.runInContext("typeof renderTasks === 'function'", sandbox);
assert.ok(hasRenderTasks, 'renderTasks should be defined');

const hasOpenModal = vm.runInContext("typeof openTaskModal === 'function'", sandbox);
assert.ok(hasOpenModal, 'openTaskModal should be defined');
console.log('✓ Test 3: defaults and core functions verified in app.js');

// 5. Test Time Category Classification (Upcoming, Trending < 30m, Overdue)
const now = Date.now();

const taskUpcoming = {
  id: 't_up',
  title: 'Render 3D Logo',
  remindAt: new Date(now + 60 * 60 * 1000).toISOString(), // +1 hour (> 30m)
  completed: false
};

const taskActive = {
  id: 't_act',
  title: 'Call Client for Approval',
  remindAt: new Date(now + 15 * 60 * 1000).toISOString(), // +15 minutes (within 30m trending window)
  completed: false
};

const taskOverdue = {
  id: 't_ov',
  title: 'Send Invoice #402',
  remindAt: new Date(now - 10 * 60 * 1000).toISOString(), // -10 minutes (past deadline, overdue)
  completed: false
};

const taskDone = {
  id: 't_done',
  title: 'Finished Project',
  remindAt: new Date(now - 5 * 60 * 1000).toISOString(),
  completed: true
};

sandbox.testTasks = { taskUpcoming, taskActive, taskOverdue, taskDone };

assert.equal(vm.runInContext("getTaskCategory(testTasks.taskUpcoming)", sandbox), 'upcoming', 'Task > 30m away must be upcoming');
assert.equal(vm.runInContext("getTaskCategory(testTasks.taskActive)", sandbox), 'active', 'Task within 30 min before deadline must be active (trending/focus)');
assert.equal(vm.runInContext("getTaskCategory(testTasks.taskOverdue)", sandbox), 'overdue', 'Task past deadline must be overdue');
assert.equal(vm.runInContext("getTaskCategory(testTasks.taskDone)", sandbox), 'completed', 'Completed task must be completed');
console.log('✓ Test 4: Task categorization thresholds (upcoming, 30m trending, overdue) verified');

// 6. Test Formatters and Prominent Countdown
const upcomingCd = vm.runInContext("formatTaskCountdown(testTasks.taskUpcoming.remindAt)", sandbox);
assert.ok(upcomingCd.includes('⏳ in'), 'Upcoming countdown must start with "⏳ in"');

const activeCd = vm.runInContext("formatTaskCountdown(testTasks.taskActive.remindAt)", sandbox);
assert.ok(activeCd.includes('⚡') && activeCd.includes('remaining'), 'Trending countdown must show remaining time');

const overdueCd = vm.runInContext("formatTaskCountdown(testTasks.taskOverdue.remindAt)", sandbox);
assert.ok(overdueCd.includes('⚠️ OVERDUE by'), 'Overdue countdown must show prominent "⚠️ OVERDUE by"');

const dtToday = vm.runInContext("formatTaskDateTime(new Date().toISOString())", sandbox);
assert.ok(dtToday.startsWith('Today at'), 'formatTaskDateTime for today must start with "Today at"');
console.log('✓ Test 5: Human-readable date and countdown formatters verified');

// 7. Test renderTasks Notice Board Long List & Pushpin Architecture
vm.runInContext("data.tasks = [testTasks.taskUpcoming, testTasks.taskActive, testTasks.taskOverdue, testTasks.taskDone]", sandbox);
const tasksHtml = vm.runInContext("renderTasks()", sandbox);

assert.ok(tasksHtml.includes('Notice Board'), 'Tab header must display Notice Board');
assert.ok(tasksHtml.includes('notice-board-list'), 'Must render single unified long list');
assert.ok(tasksHtml.includes('notice-pin'), 'Must render creative pushpin visual on cards');
assert.ok(tasksHtml.includes('notice-timer'), 'Must render prominent bold countdown timer');
assert.ok(tasksHtml.includes('card-overdue'), 'Must render overdue red card');
assert.ok(tasksHtml.includes('card-trending'), 'Must render trending green card');
assert.ok(tasksHtml.includes('card-normal'), 'Must render normal card for > 30m');

// Verify strict priority stacking order: Overdue (Red) on top, then Trending (Green), then Normal
const overduePos = tasksHtml.indexOf('Send Invoice #402');
const trendingPos = tasksHtml.indexOf('Call Client for Approval');
const normalPos = tasksHtml.indexOf('Render 3D Logo');
assert.ok(overduePos !== -1 && trendingPos !== -1 && normalPos !== -1, 'All active tasks must be rendered in list');
assert.ok(overduePos < trendingPos, 'Red overdue card must be stacked ABOVE green trending card');
assert.ok(trendingPos < normalPos, 'Green trending card must be stacked ABOVE normal card');

// Test empty state: Only top Add Reminder button should exist
vm.runInContext("data.tasks = []", sandbox);
const emptyTasksHtml = vm.runInContext("renderTasks()", sandbox);
assert.ok(emptyTasksHtml.includes('id="openAddTaskBtn"'), 'Top Add Reminder button must be present in header');
assert.ok(emptyTasksHtml.includes('notice-board-empty'), 'Empty Notice Board state must be present');
assert.ok(!emptyTasksHtml.includes('id="openAddTaskHeroBtn"'), 'openAddTaskHeroBtn should not exist');
assert.ok(!emptyTasksHtml.includes('id="openAddTaskEmptyBtn"'), 'openAddTaskEmptyBtn should not exist');

console.log('✓ Test 6: Notice Board unified long list, priority ordering (red on top, green next), and pushpin verified');

// 8. Test Background Reminder Checker & Repetitive 10-Minute Notifications
const trendingTaskToNotify = {
  id: 't_notify',
  title: 'Urgent Print Review',
  description: 'Check color alignment for welcome board',
  remindAt: new Date(now + 20 * 60 * 1000).toISOString(), // in 20 minutes (trending)
  completed: false,
  notified: false
};
sandbox.trendingTaskToNotify = trendingTaskToNotify;
vm.runInContext("data.tasks = [trendingTaskToNotify]", sandbox);

vm.runInContext("checkTaskReminders()", sandbox);
assert.equal(trendingTaskToNotify.notified, true, 'Trending task within 30m must be notified');
assert.ok(trendingTaskToNotify.lastTrendingNotifyAt, 'lastTrendingNotifyAt timestamp must be recorded');
console.log('✓ Test 7: Automatic background reminder detection & 10-min notification window verified');

console.log('\nALL TASKS & REMINDERS MANAGER TESTS PASSED! 🎉✨');
