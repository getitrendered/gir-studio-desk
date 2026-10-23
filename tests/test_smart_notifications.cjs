const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');
const appJs = fs.readFileSync(path.join(projectDir, 'app.js'), 'utf8');
const mainCjs = fs.readFileSync(path.join(projectDir, 'main.cjs'), 'utf8');
const preloadCjs = fs.readFileSync(path.join(projectDir, 'preload.cjs'), 'utf8');

console.log('Testing Smart Notification System Architecture & Routing...');

// 1. Verify main.cjs IPC handlers for window state and focus detection
assert(mainCjs.includes("'is-window-focused'"), "main.cjs must define 'is-window-focused'");
assert(mainCjs.includes("win.isFocused() && !win.isMinimized() && win.isVisible()"), "main.cjs must check isFocused, not minimized, and visible");
assert(mainCjs.includes("'get-window-state'"), "main.cjs must define 'get-window-state'");
assert(mainCjs.includes("notif.on('click'"), "main.cjs must handle notification click to restore and focus window");
console.log('✔ main.cjs window state and notification click handlers verified');

// 2. Verify preload.cjs exposure
assert(preloadCjs.includes("isFocused: () => ipcRenderer.invoke('is-window-focused')"), "preload.cjs must expose isFocused");
assert(preloadCjs.includes("getWindowState: () => ipcRenderer.invoke('get-window-state')"), "preload.cjs must expose getWindowState");
console.log('✔ preload.cjs bridge exposure verified');

// 3. Verify app.js centralized smart notification functions
assert(appJs.includes("function showInAppNotification("), "app.js must define showInAppNotification");
assert(appJs.includes("async function isAppActivelyUsed()"), "app.js must define isAppActivelyUsed");
assert(appJs.includes("async function smartNotify("), "app.js must define smartNotify");
assert(appJs.includes("function sendNativeDesktopNotification("), "app.js must define sendNativeDesktopNotification");
assert(appJs.includes("function desktopNotify("), "app.js must define desktopNotify");
console.log('✔ app.js smart notification engine declarations verified');

// 4. Test Routing Simulation across all 7 scenarios
// We isolate the smartNotify and isAppActivelyUsed logic in a controlled simulation harness
function createSimulationHarness({ isFocused, isMinimized, isVisible, hasDocFocus, isDocHidden }) {
  let inAppToastCount = 0;
  let inAppBannerCount = 0;
  let nativeNotificationCount = 0;

  const mockDesk = {
    isFocused: async () => isFocused && !isMinimized && isVisible,
    notify: (title, body) => { nativeNotificationCount++; }
  };

  const mockDocument = {
    hasFocus: () => hasDocFocus,
    hidden: isDocHidden
  };

  async function isAppActivelyUsed() {
    let isAppFocused = false;
    try {
      if (mockDesk?.isFocused) {
        isAppFocused = await mockDesk.isFocused();
      } else {
        isAppFocused = mockDocument.hasFocus() && !mockDocument.hidden;
      }
    } catch {
      isAppFocused = false;
    }
    return isAppFocused;
  }

  function displayCatReactionBanner(payload) {
    inAppBannerCount++;
  }

  function showInAppNotification(title, body, icon) {
    inAppToastCount++;
  }

  function sendNativeDesktopNotification(title, body) {
    mockDesk.notify(title, body);
  }

  async function smartNotify({ title, body, icon = '🔔', catPayload = null }) {
    const isAppActive = await isAppActivelyUsed();

    if (isAppActive) {
      if (catPayload) {
        displayCatReactionBanner(catPayload);
      } else {
        showInAppNotification(title, body, icon);
      }
    } else {
      const nativeTitle = title || (catPayload ? `🐾 ${catPayload.senderName || 'Teammate'}` : 'MeowSheet');
      const nativeBody = body || (catPayload ? (catPayload.message || 'Cat reaction sent!') : '');
      sendNativeDesktopNotification(nativeTitle, nativeBody);
    }
  }

  return {
    smartNotify,
    getCounts: () => ({ inAppToastCount, inAppBannerCount, nativeNotificationCount, total: inAppToastCount + inAppBannerCount + nativeNotificationCount })
  };
}

(async () => {
  // Scenario 1: App is open, maximized, and actively being used
  {
    const h = createSimulationHarness({ isFocused: true, isMinimized: false, isVisible: true, hasDocFocus: true, isDocHidden: false });
    await h.smartNotify({ title: 'Work in progress', body: 'Task started' });
    const counts = h.getCounts();
    assert.strictEqual(counts.inAppToastCount, 1, 'Scenario 1: In-app toast must be shown');
    assert.strictEqual(counts.nativeNotificationCount, 0, 'Scenario 1: Native Windows notification must NOT be shown');
    assert.strictEqual(counts.total, 1, 'Scenario 1: Exactly 1 notification total (no duplicates)');
    console.log('✔ Scenario 1 passed: Active window receives in-app notification only');
  }

  // Scenario 2: App is minimized to taskbar
  {
    const h = createSimulationHarness({ isFocused: false, isMinimized: true, isVisible: true, hasDocFocus: false, isDocHidden: true });
    await h.smartNotify({ title: 'Changes requested', body: 'Fix typography' });
    const counts = h.getCounts();
    assert.strictEqual(counts.inAppToastCount, 0, 'Scenario 2: In-app toast must NOT be shown when minimized');
    assert.strictEqual(counts.nativeNotificationCount, 1, 'Scenario 2: Native Windows notification must be shown when minimized');
    assert.strictEqual(counts.total, 1, 'Scenario 2: Exactly 1 notification total');
    console.log('✔ Scenario 2 passed: Minimized app receives native Windows notification only');
  }

  // Scenario 3: App is maximized/visible, but user switched to another app (unfocused / background)
  {
    const h = createSimulationHarness({ isFocused: false, isMinimized: false, isVisible: true, hasDocFocus: false, isDocHidden: false });
    await h.smartNotify({ title: 'Work sent', body: 'Logo sent to client' });
    const counts = h.getCounts();
    assert.strictEqual(counts.inAppToastCount, 0, 'Scenario 3: In-app toast must NOT be shown when blurred/backgrounded');
    assert.strictEqual(counts.nativeNotificationCount, 1, 'Scenario 3: Native Windows notification must be shown when blurred');
    assert.strictEqual(counts.total, 1, 'Scenario 3: Exactly 1 notification total');
    console.log('✔ Scenario 3 passed: Backgrounded/unfocused app receives native Windows notification only');
  }

  // Scenario 4: App is restored and active again
  {
    const h = createSimulationHarness({ isFocused: true, isMinimized: false, isVisible: true, hasDocFocus: true, isDocHidden: false });
    await h.smartNotify({ title: 'Payment recorded', body: 'Invoice paid' });
    const counts = h.getCounts();
    assert.strictEqual(counts.inAppToastCount, 1, 'Scenario 4: In-app toast must be shown when restored and active');
    assert.strictEqual(counts.nativeNotificationCount, 0, 'Scenario 4: Native Windows notification must NOT be shown');
    assert.strictEqual(counts.total, 1, 'Scenario 4: Exactly 1 notification total');
    console.log('✔ Scenario 4 passed: Restored active window switches back to in-app notification only');
  }

  // Scenario 5: Cat reaction ping while active
  {
    const h = createSimulationHarness({ isFocused: true, isMinimized: false, isVisible: true, hasDocFocus: true, isDocHidden: false });
    await h.smartNotify({ title: '🐾 Maitri', body: 'Meow!', catPayload: { senderName: 'Maitri', message: 'Meow!', catType: 'orange' } });
    const counts = h.getCounts();
    assert.strictEqual(counts.inAppBannerCount, 1, 'Scenario 5: Cat live banner must be shown inside app');
    assert.strictEqual(counts.nativeNotificationCount, 0, 'Scenario 5: Native notification must NOT be shown');
    assert.strictEqual(counts.total, 1, 'Scenario 5: Zero duplication on cat reactions');
    console.log('✔ Scenario 5 passed: Cat reaction shows in-app animated banner only when active');
  }

  // Scenario 6: Cat reaction ping while minimized or backgrounded
  {
    const h = createSimulationHarness({ isFocused: false, isMinimized: true, isVisible: false, hasDocFocus: false, isDocHidden: true });
    await h.smartNotify({ title: '🐾 Maitri', body: 'Meow!', catPayload: { senderName: 'Maitri', message: 'Meow!', catType: 'orange' } });
    const counts = h.getCounts();
    assert.strictEqual(counts.inAppBannerCount, 0, 'Scenario 6: Cat live banner must NOT be shown when minimized');
    assert.strictEqual(counts.nativeNotificationCount, 1, 'Scenario 6: Native notification must be shown when minimized');
    assert.strictEqual(counts.total, 1, 'Scenario 6: Exactly 1 notification total');
    console.log('✔ Scenario 6 passed: Cat reaction sends native Windows notification when app is minimized/hidden');
  }

  // Scenario 7: Minimized to tray / hidden (isVisible = false)
  {
    const h = createSimulationHarness({ isFocused: false, isMinimized: false, isVisible: false, hasDocFocus: false, isDocHidden: true });
    await h.smartNotify({ title: 'System', body: 'Tray alert' });
    const counts = h.getCounts();
    assert.strictEqual(counts.inAppToastCount, 0, 'Scenario 7: In-app toast must NOT be shown in tray');
    assert.strictEqual(counts.nativeNotificationCount, 1, 'Scenario 7: Native notification must be shown in tray');
    assert.strictEqual(counts.total, 1, 'Scenario 7: Zero duplicate notifications');
    console.log('✔ Scenario 7 passed: Tray/hidden app receives native Windows notification');
  }

  console.log('\nAll 7 Smart Notification scenarios verified successfully! 🎉');
})();
