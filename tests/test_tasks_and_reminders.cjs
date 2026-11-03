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

// 5. Test Time Category Classification (Upcoming, Active 30m, Overdue)
const now = Date.now();

const taskUpcoming = {
  id: 't_up',
  title: 'Render 3D Logo',
  remindAt: new Date(now + 60 * 60 * 1000).toISOString(), // +1 hour
  completed: false
};

const taskActive = {
  id: 't_act',
  title: 'Call Client for Approval',
  remindAt: new Date(now - 10 * 60 * 1000).toISOString(), // -10 minutes (within 30m window)
  completed: false
};

const taskOverdue = {
  id: 't_ov',
  title: 'Send Invoice #402',
  remindAt: new Date(now - 45 * 60 * 1000).toISOString(), // -45 minutes (> 30m window)
  completed: false
};

const taskDone = {
  id: 't_done',
  title: 'Finished Project',
  remindAt: new Date(now - 5 * 60 * 1000).toISOString(),
  completed: true
};

sandbox.testTasks = { taskUpcoming, taskActive, taskOverdue, taskDone };

assert.equal(vm.runInContext("getTaskCategory(testTasks.taskUpcoming)", sandbox), 'upcoming', 'Future task must be upcoming');
assert.equal(vm.runInContext("getTaskCategory(testTasks.taskActive)", sandbox), 'active', 'Task within 30 min window must be active (Current Important)');
assert.equal(vm.runInContext("getTaskCategory(testTasks.taskOverdue)", sandbox), 'overdue', 'Task past 30 min window must be overdue');
assert.equal(vm.runInContext("getTaskCategory(testTasks.taskDone)", sandbox), 'completed', 'Completed task must be completed');
console.log('✓ Test 4: Task categorization thresholds (upcoming, 30m active window, overdue) verified');

// 6. Test Formatters and Countdown
const upcomingCd = vm.runInContext("formatTaskCountdown(testTasks.taskUpcoming.remindAt)", sandbox);
assert.ok(upcomingCd.includes('⏳ in'), 'Upcoming countdown must start with "⏳ in"');

const activeCd = vm.runInContext("formatTaskCountdown(testTasks.taskActive.remindAt)", sandbox);
assert.ok(activeCd.includes('⚡ Active') && activeCd.includes('left'), 'Active countdown must show remaining active window time');

const overdueCd = vm.runInContext("formatTaskCountdown(testTasks.taskOverdue.remindAt)", sandbox);
assert.ok(overdueCd.includes('⚠️ Overdue by'), 'Overdue countdown must show "⚠️ Overdue by"');

const dtToday = vm.runInContext("formatTaskDateTime(new Date().toISOString())", sandbox);
assert.ok(dtToday.startsWith('Today at'), 'formatTaskDateTime for today must start with "Today at"');
console.log('✓ Test 5: Human-readable date and countdown formatters verified');

// 7. Test renderTasks Output HTML
vm.runInContext("data.tasks = [testTasks.taskUpcoming, testTasks.taskActive, testTasks.taskOverdue, testTasks.taskDone]", sandbox);
const tasksHtml = vm.runInContext("renderTasks()", sandbox);

assert.ok(tasksHtml.includes('Important Upcoming Tasks'), 'Tasks tab must render Hero Deck');
assert.ok(tasksHtml.includes('Overdue Tasks'), 'Tasks tab must render Overdue Tasks section');
assert.ok(tasksHtml.includes('Current Important Tasks'), 'Tasks tab must render Current Important Tasks section');
assert.ok(tasksHtml.includes('Scheduled Reminders'), 'Tasks tab must render Scheduled Reminders section');
assert.ok(tasksHtml.includes('Completed Tasks'), 'Tasks tab must render Completed Tasks section');
assert.ok(tasksHtml.includes('Render 3D Logo'), 'Upcoming task title must be in HTML');
assert.ok(tasksHtml.includes('Call Client for Approval'), 'Active task title must be in HTML');
assert.ok(tasksHtml.includes('Send Invoice #402'), 'Overdue task title must be in HTML');

// Test empty state: Only top Add Task button should exist, no redundant inner buttons
vm.runInContext("data.tasks = []", sandbox);
const emptyTasksHtml = vm.runInContext("renderTasks()", sandbox);
assert.ok(emptyTasksHtml.includes('id="openAddTaskBtn"'), 'Top Add Task button must be present in header');
assert.ok(!emptyTasksHtml.includes('id="openAddTaskHeroBtn"'), 'openAddTaskHeroBtn should be removed');
assert.ok(!emptyTasksHtml.includes('id="openAddTaskEmptyBtn"'), 'openAddTaskEmptyBtn should be removed');

console.log('✓ Test 6: renderTasks HTML structure and sections verified');

// 8. Test Background Reminder Checker & Notifications
const dueTaskToNotify = {
  id: 't_notify',
  title: 'Urgent Print Review',
  description: 'Check color alignment for welcome board',
  remindAt: new Date(now - 2000).toISOString(),
  completed: false,
  notified: false
};
sandbox.dueTaskToNotify = dueTaskToNotify;
vm.runInContext("data.tasks = [dueTaskToNotify]", sandbox);

vm.runInContext("checkTaskReminders()", sandbox);
assert.equal(dueTaskToNotify.notified, true, 'Task should be marked notified after checkTaskReminders runs');
console.log('✓ Test 7: Automatic background reminder detection & notification firing verified');

console.log('\nALL TASKS & REMINDERS MANAGER TESTS PASSED! 🎉✨');
