const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('Testing Dark Mode Theme & Controls (v0.2.61)...');

// 1. Verify CSS rules in extras.css
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'extras.css'), 'utf8');

assert.ok(cssContent.includes('[data-theme="dark"]'), 'extras.css should contain [data-theme="dark"] rules');
assert.ok(cssContent.includes('--bg: #0b131b') || cssContent.includes('--bg:#0b131b'), 'Dark mode should set deep obsidian background variable');
assert.ok(cssContent.includes('--ink: #f1f5f9') || cssContent.includes('--ink:#f1f5f9'), 'Dark mode should set high-contrast crisp text variable');
assert.ok(cssContent.includes('.theme-toggle-btn'), 'extras.css should define .theme-toggle-btn');
assert.ok(cssContent.includes('[data-theme="dark"] .tabs-header'), 'Dark mode should style .tabs-header');
assert.ok(cssContent.includes('[data-theme="dark"] .client-tabs'), 'Dark mode should style .client-tabs');
assert.ok(cssContent.includes('[data-theme="dark"] .sheet-toolbar'), 'Dark mode should style .sheet-toolbar');
assert.ok(cssContent.includes('[data-theme="dark"] table.sheet'), 'Dark mode should style table.sheet');
assert.ok(cssContent.includes('[data-theme="dark"] .sheet td:not(.status-cell)'), 'Dark mode should style .sheet td:not(.status-cell)');
assert.ok(cssContent.includes('[data-theme="dark"] .sheet tr.has-entry td:not(.status-cell)'), 'Dark mode should style .sheet tr.has-entry td:not(.status-cell)');
assert.ok(cssContent.includes('[data-theme="dark"] .client-tab'), 'Dark mode should style .client-tab');
assert.ok(cssContent.includes('[data-theme="dark"] .client-tab small.pending-badge'), 'Dark mode should style .client-tab small.pending-badge');
assert.ok(cssContent.includes('[data-theme="dark"] .client-tab small.sent-badge'), 'Dark mode should style .client-tab small.sent-badge');
assert.ok(cssContent.includes('[data-theme="dark"] .context-menu'), 'Dark mode should style .context-menu');
assert.ok(cssContent.includes('[data-theme="dark"] .modal'), 'Dark mode should style .modal');
assert.ok(cssContent.includes('[data-theme="dark"] .card'), 'Dark mode should style .card');
assert.ok(cssContent.includes('[data-theme="dark"] .panel'), 'Dark mode should style .panel');
assert.ok(cssContent.includes('[data-theme="dark"] .tracker-card'), 'Dark mode should style .tracker-card');
assert.ok(cssContent.includes('[data-theme="dark"] #toast'), 'Dark mode should style #toast');

console.log('✓ Test 1: extras.css comprehensive dark mode selectors and variables verified');

// 2. Verify HTML structure in index.html
const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.ok(htmlContent.includes('id="themeToggleBtn"'), 'index.html should include #themeToggleBtn');
assert.ok(htmlContent.includes('class="theme-toggle-btn"'), 'index.html should include class="theme-toggle-btn"');

console.log('✓ Test 2: index.html header theme toggle button verified');

// 3. Test Theme Engine and Dynamic Switching in app.js
const appJsSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const elementsMap = new Map();
function createMockElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    style: { setProperty() {} },
    dataset: {},
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this.classes.has(c)) this.classes.delete(c);
          else this.classes.add(c);
        } else if (force) {
          this.classes.add(c);
        } else {
          this.classes.delete(c);
        }
      },
      contains(c) { return this.classes.has(c); }
    },
    children: [],
    attributes: {},
    innerHTML: '',
    value: '',
    title: '',
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(child) { this.children.push(child); return child; },
    remove() {},
    querySelector(selector) { return createMockElement('div'); },
    querySelectorAll(selector) { return []; },
    addEventListener() {},
    offsetWidth: 235,
    offsetHeight: 420
  };
  return el;
}

const docElement = createMockElement('html');
const bodyElement = createMockElement('body');
const themeToggleBtn = createMockElement('button');
themeToggleBtn.id = 'themeToggleBtn';

const settingsThemeSelect = createMockElement('select');
settingsThemeSelect.id = 'settingsThemeSelect';

let themePassedToMain = null;

const context = {
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
  window: {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
    matchMedia: query => ({
      matches: false,
      addEventListener() {}
    }),
    desk: {
      updates: { onChange() {}, checkForUpdates() {}, state: () => Promise.resolve({ status: 'idle' }) },
      setTheme: theme => {
        themePassedToMain = theme;
        return Promise.resolve(theme);
      }
    }
  },
  document: {
    documentElement: docElement,
    body: bodyElement,
    createElement: tag => createMockElement(tag),
    querySelector: sel => {
      if (sel === '#themeToggleBtn') return themeToggleBtn;
      if (sel === '#settingsThemeSelect') return settingsThemeSelect;
      return createMockElement(sel);
    },
    querySelectorAll: sel => [],
    addEventListener: () => {}
  },
  $: sel => {
    if (sel === '#themeToggleBtn') return themeToggleBtn;
    if (sel === '#settingsThemeSelect') return settingsThemeSelect;
    return createMockElement(sel);
  },
  $$: sel => [],
  num: v => Number(v) || 0,
  money: v => `₹${Number(v).toLocaleString('en-IN')}`,
  esc: s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  uid: () => 'uid-test',
  today: () => '2026-11-03',
  clientItems: () => [],
  unfinishedCount: () => 0,
  toast: msg => console.log('Toast:', msg),
  console
};

vm.createContext(context);
vm.runInContext(appJsSource, context);

// 4. Test getEffectiveTheme logic
const lightRes = vm.runInContext("getEffectiveTheme('light')", context);
assert.strictEqual(lightRes, 'light', 'getEffectiveTheme("light") should return "light"');

const darkRes = vm.runInContext("getEffectiveTheme('dark')", context);
assert.strictEqual(darkRes, 'dark', 'getEffectiveTheme("dark") should return "dark"');

const sysLightRes = vm.runInContext("getEffectiveTheme('system')", context);
assert.strictEqual(sysLightRes, 'light', 'getEffectiveTheme("system") on light OS should return "light"');

// Simulate dark OS
context.window.matchMedia = query => ({ matches: true, addEventListener() {} });
const sysDarkRes = vm.runInContext("getEffectiveTheme('system')", context);
assert.strictEqual(sysDarkRes, 'dark', 'getEffectiveTheme("system") on dark OS should return "dark"');

console.log('✓ Test 3: getEffectiveTheme handles light, dark, and system OS detection correctly');

// 5. Test applyTheme('dark')
vm.runInContext("applyTheme('dark')", context);
assert.strictEqual(docElement.getAttribute('data-theme'), 'dark', 'documentElement should have data-theme="dark"');
assert.ok(bodyElement.classList.contains('dark-theme'), 'body should have "dark-theme" class');
assert.ok(themeToggleBtn.innerHTML.includes('☀️'), 'Theme toggle button should display ☀️ icon when dark');
assert.strictEqual(themeToggleBtn.title, 'Switch to Light Mode', 'Theme toggle tooltip should offer switch to Light Mode');
assert.strictEqual(themePassedToMain, 'dark', 'Theme should be sent to Electron main process via window.desk.setTheme');

console.log('✓ Test 4: applyTheme("dark") activates dark mode, updates toggle icon to ☀️, and syncs with Electron main process');

// 6. Test toggleTheme() switches to Light
vm.runInContext("toggleTheme()", context);
assert.strictEqual(docElement.getAttribute('data-theme'), 'light', 'documentElement should have data-theme="light" after toggle');
assert.ok(!bodyElement.classList.contains('dark-theme'), 'body should NOT have "dark-theme" class');
assert.ok(themeToggleBtn.innerHTML.includes('🌙'), 'Theme toggle button should display 🌙 icon when light');
assert.strictEqual(themeToggleBtn.title, 'Switch to Dark Mode', 'Theme toggle tooltip should offer switch to Dark Mode');

console.log('✓ Test 5: toggleTheme() seamlessly toggles back to light mode with 🌙 icon');

// 7. Test renderSettings() includes Theme select
const settingsHtml = vm.runInContext("renderSettings()", context);
assert.ok(settingsHtml.includes('data-setting="theme"'), 'renderSettings should contain data-setting="theme"');
assert.ok(settingsHtml.includes('id="settingsThemeSelect"'), 'renderSettings should contain #settingsThemeSelect');
assert.ok(settingsHtml.includes('Light Mode') && settingsHtml.includes('Dark Mode') && settingsHtml.includes('System Default'), 'Settings should offer Light, Dark, and System Default choices');

console.log('✓ Test 6: Workspace Settings tab includes Theme selector dropdown');

console.log('\nALL DARK MODE TESTS PASSED SUCCESSFULLY! 🌙✨');
