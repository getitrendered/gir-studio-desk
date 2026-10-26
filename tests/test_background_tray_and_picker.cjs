const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');
const mainCjs = fs.readFileSync(path.join(projectDir, 'main.cjs'), 'utf8');
const appJs = fs.readFileSync(path.join(projectDir, 'app.js'), 'utf8');
const preloadCjs = fs.readFileSync(path.join(projectDir, 'preload.cjs'), 'utf8');

console.log('Testing Background System Tray & In-Picker Cat Switching...\n');

// 1. Verify System Tray integration in main.cjs
assert(mainCjs.includes("Tray, Menu"), "main.cjs must import Tray and Menu from electron");
assert(mainCjs.includes("function createTray()"), "main.cjs must define createTray");
assert(mainCjs.includes("tray.setToolTip('MeowSheet · Active & Connected')"), "tray must set tooltip");
assert(mainCjs.includes("Open MeowSheet"), "tray menu must have Open MeowSheet");
assert(mainCjs.includes("Quit MeowSheet"), "tray menu must have Quit MeowSheet");
assert(mainCjs.includes("tray.on('click'"), "tray must handle single click to restore and focus");
assert(mainCjs.includes("tray.on('double-click'"), "tray must handle double click to restore and focus");
console.log('✓ Test 1: System Tray setup and context menu verified');

// 2. Verify Close-to-Tray (Run in Background) in main.cjs
assert(mainCjs.includes("win.on('close'"), "main.cjs must intercept win.on('close')");
assert(mainCjs.includes("event.preventDefault()"), "close event must prevent default when not quitting");
assert(mainCjs.includes("win.hide()"), "close event must hide window to tray instead of quitting");
assert(mainCjs.includes("backgroundThrottling: false"), "main.cjs must disable backgroundThrottling for uninterrupted background WebSocket");
assert(mainCjs.includes("app.requestSingleInstanceLock"), "main.cjs must enforce single instance lock");
assert(mainCjs.includes("second-instance"), "main.cjs must focus existing window on second instance launch");
assert(mainCjs.includes("app.on('before-quit'"), "main.cjs must track isQuitting before quit");
console.log('✓ Test 2: Close-to-Tray and single instance background execution verified');

// 3. Verify in-picker Orange Cat vs Black Cat toggle in app.js
assert(appJs.includes('id="catPickerRoot"'), "catPickerRoot element must exist as re-render target");
assert(appJs.includes("const root = document.getElementById('catPickerRoot')"), "updateModalBody must query catPickerRoot");
assert(appJs.includes("root.outerHTML = renderPickerContent()"), "updateModalBody must replace outerHTML cleanly");
assert(appJs.includes("if (chosenCat === 'orange') return;"), "Orange Cat pill toggle check");
assert(appJs.includes("if (chosenCat === 'black') return;"), "Black Cat pill toggle check");
console.log('✓ Test 3: In-picker instant Cat Spirit switching verified');

console.log('\nALL BACKGROUND TRAY AND PICKER TESTS PASSED! 🎉');
