const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

app.setAppUserModelId('com.meowsheet.app');
const legacyUserData = path.join(app.getPath('appData'), 'gir-studio-desk');
const targetUserData = path.join(app.getPath('appData'), 'meowsheet');
try {
  if (!fs.existsSync(targetUserData) && fs.existsSync(legacyUserData)) {
    fs.cpSync(legacyUserData, targetUserData, { recursive: true });
  } else if (fs.existsSync(path.join(legacyUserData, 'ledger.json')) && !fs.existsSync(path.join(targetUserData, 'ledger.json'))) {
    fs.mkdirSync(targetUserData, { recursive: true });
    fs.copyFileSync(path.join(legacyUserData, 'ledger.json'), path.join(targetUserData, 'ledger.json'));
  }
} catch (err) {
  console.error('Data migration notice:', err);
}
app.setPath('userData', targetUserData);

function cleanupLegacyInstallation() {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const legacyProg = path.join(localAppData, 'Programs', 'gir-studio-desk');
    const legacyUninstaller = path.join(legacyProg, 'Uninstall GIR Studio Desk.exe');
    if (fs.existsSync(legacyUninstaller)) {
      spawn(legacyUninstaller, ['/S', `_?=${legacyProg}`], { detached: true, stdio: 'ignore' }).unref();
    } else if (fs.existsSync(legacyProg)) {
      try { fs.rmSync(legacyProg, { recursive: true, force: true }); } catch {}
    }
    const desktops = [
      path.join(process.env.USERPROFILE || '', 'Desktop'),
      path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop')
    ];
    desktops.forEach(d => {
      const oldLnk = path.join(d, 'GIR Studio Desk.lnk');
      if (fs.existsSync(oldLnk)) {
        try { fs.unlinkSync(oldLnk); } catch {}
      }
    });
  } catch (err) {
    console.error('Legacy app cleanup notice:', err);
  }
}
cleanupLegacyInstallation();

const cachedIconPath = path.join(targetUserData, 'gir-icon.png');
try {
  const unpackedIcon = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'assets', 'gir-icon.png');
  const sourceIcon = fs.existsSync(unpackedIcon) ? unpackedIcon : path.join(__dirname, 'assets', 'gir-icon.png');
  if (fs.existsSync(sourceIcon) && !fs.existsSync(cachedIconPath)) {
    fs.copyFileSync(sourceIcon, cachedIconPath);
  }
} catch {}

function ensureNotificationBannerSettings() {
  if (process.platform !== 'win32') return;
  try {
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\com.meowsheet.app';
    const values = [
      ['ShowBanner', '1'],
      ['Enabled', '1'],
      ['ShowInActionCenter', '1'],
      ['Sound', '1']
    ];
    for (const [name, val] of values) {
      spawn('reg.exe', ['add', regKey, '/v', name, '/t', 'REG_DWORD', '/d', val, '/f'], {
        windowsHide: true,
        stdio: 'ignore'
      }).unref();
    }
  } catch {}
}
ensureNotificationBannerSettings();

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe).replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

let win;
let tray = null;
let isQuitting = false;
let hasShownTrayTip = false;
let bannerWin = null;
let bannerTimer = null;
let updater;
let updateState = { status: 'unavailable', version: app.getVersion(), message: 'Install a release build to receive updates.' };
const file = () => path.join(app.getPath('userData'), 'ledger.json');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAndFocusWindow();
  });
}

function showAndFocusWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function getBannerWindow() {
  if (bannerWin && !bannerWin.isDestroyed()) return bannerWin;

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;
  const width = 380;
  const height = 96;
  const x = Math.round(workArea.x + workArea.width - width - 24);
  const y = Math.round(workArea.y + 24);

  bannerWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  bannerWin.setAlwaysOnTop(true, 'screen-saver');
  bannerWin.setVisibleOnAllWorkspaces(true);
  bannerWin.loadFile(path.join(__dirname, 'banner.html'));
  return bannerWin;
}

function showDesktopBannerOverlay(payload) {
  try {
    const bWin = getBannerWindow();
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { workArea } = primaryDisplay;
    const width = 380;
    const height = 96;
    const x = Math.round(workArea.x + workArea.width - width - 24);
    const y = Math.round(workArea.y + 24);

    bWin.setBounds({ x, y, width, height });

    const sendAndShow = () => {
      bWin.webContents.send('display-banner', payload);
      bWin.showInactive();
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        if (bannerWin && !bannerWin.isDestroyed()) {
          bannerWin.webContents.send('hide-banner');
          setTimeout(() => {
            if (bannerWin && !bannerWin.isDestroyed()) bannerWin.hide();
          }, 400);
        }
      }, 6000);
    };

    if (bWin.webContents.isLoading()) {
      bWin.webContents.once('did-finish-load', sendAndShow);
    } else {
      sendAndShow();
    }
  } catch (err) {
    console.error('Desktop banner overlay error:', err);
  }
}

function createTray() {
  if (tray) return;
  const trayIconPath = path.join(__dirname, 'assets', 'gir-icon.png');
  if (!fs.existsSync(trayIconPath)) return;
  tray = new Tray(trayIconPath);
  tray.setToolTip('MeowSheet · Active & Connected');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open MeowSheet',
      click: () => {
        showAndFocusWindow();
      }
    },
    {
      label: 'Check for updates…',
      click: () => {
        showAndFocusWindow();
        if (updater) {
          updater.checkForUpdates().catch(error => reportUpdate({ status: 'error', message: `Update check failed: ${error.message}` }));
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit MeowSheet',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => showAndFocusWindow());
  tray.on('double-click', () => showAndFocusWindow());
}

function reportUpdate(next) {
  updateState = { ...updateState, ...next };
  if (win && !win.isDestroyed()) win.webContents.send('update-state', updateState);
}
function initUpdates() {
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on('checking-for-update', () => reportUpdate({ status: 'checking', message: 'Checking GitHub Releases…' }));
    updater.on('update-available', info => reportUpdate({ status: 'available', latestVersion: info.version, message: `Version ${info.version} is available.` }));
    updater.on('update-not-available', () => reportUpdate({ status: 'current', latestVersion: app.getVersion(), message: 'You have the latest version.' }));
    updater.on('download-progress', progress => reportUpdate({ status: 'downloading', percent: Math.round(progress.percent), message: `Downloading update · ${Math.round(progress.percent)}%` }));
    updater.on('update-downloaded', info => reportUpdate({ status: 'ready', latestVersion: info.version, percent: 100, message: 'Update ready. Restart to install.' }));
    updater.on('error', error => reportUpdate({ status: 'error', message: `Update failed: ${error.message}` }));
    reportUpdate({ status: 'idle', message: 'Updates from GitHub Releases' });
    const check = () => updater.checkForUpdates().catch(error => reportUpdate({ status: 'error', message: `Update check failed: ${error.message}` }));
    setTimeout(check, 12000);
    setInterval(check, 6 * 60 * 60 * 1000).unref();
  } catch (error) {
    reportUpdate({ status: 'error', message: `Updater unavailable: ${error.message}` });
  }
}
function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1080,
    minHeight: 660,
    show: false,
    backgroundColor: '#f7f8fa',
    title: 'MeowSheet',
    icon: path.join(__dirname, 'assets', 'gir-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    const startHidden = process.argv.includes('--hidden') || process.argv.includes('--minimized');
    if (!startHidden) {
      win.show();
      reportUpdate({});
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('focus', () => {
    win.flashFrame(false);
  });

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
      if (!hasShownTrayTip && tray) {
        hasShownTrayTip = true;
        tray.displayBalloon?.({
          iconType: 'info',
          title: 'MeowSheet is running in the background',
          content: 'You will stay connected and receive partner updates and cat reactions. Right-click the cat tray icon to quit.'
        });
      }
      return false;
    }
  });
}
app.whenReady().then(() => {
  createTray();
  createWindow();
  initUpdates();
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    } catch {}
  }
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
    else showAndFocusWindow();
  });
});
app.on('before-quit', () => {
  isQuitting = true;
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});
ipcMain.handle('read-store', () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return null; } });
ipcMain.handle('write-store', (_e, value) => {
  if (!value || JSON.stringify(value).length > 30_000_000) throw new Error('Invalid or oversized data');
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = file() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(value), 'utf8'); fs.renameSync(tmp, file()); return true;
});
ipcMain.handle('choose-workbook', async () => {
  const picked = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] });
  if (picked.canceled) return null;
  return new Promise((resolve, reject) => {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'import-xlsx.ps1');
    const importer = fs.existsSync(unpacked) ? unpacked : path.join(__dirname, 'import-xlsx.ps1');
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', importer, '-Path', picked.filePaths[0]], { windowsHide: true });
    let output = '', error = '';
    child.stdout.on('data', b => output += b.toString()); child.stderr.on('data', b => error += b.toString());
    child.on('error', reject);
    child.on('close', code => { if (code) reject(new Error(error || 'Workbook import failed')); else { try { const parsed = JSON.parse(output); parsed.fileHash = crypto.createHash('sha256').update(fs.readFileSync(picked.filePaths[0])).digest('hex'); resolve(parsed); } catch { reject(new Error('Workbook output was invalid: ' + error)); } } });
  });
});
ipcMain.handle('print-invoice', async () => { if (!win) return; await win.webContents.print({ silent: false, printBackground: true }); });
ipcMain.handle('save-invoice-pdf', async (_e, { defaultFileName }) => {
  if (!win || win.isDestroyed()) return { success: false, error: 'No active window' };
  try {
    const downloadsFolder = app.getPath('downloads');
    const safeName = (defaultFileName || 'Invoice').replace(/[/\\?%*:|"<>]/g, '_');
    const defaultPath = path.join(downloadsFolder, `${safeName}.pdf`);

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save Invoice PDF',
      defaultPath,
      filters: [
        { name: 'PDF Documents (*.pdf)', extensions: ['pdf'] },
        { name: 'All Files (*.*)', extensions: ['*'] }
      ]
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: false,
      preferCSSPageSize: true
    });

    await fs.promises.writeFile(filePath, pdfBuffer);
    return { success: true, filePath, canceled: false };
  } catch (err) {
    console.error('Error saving invoice PDF:', err);
    return { success: false, error: err.message };
  }
});
ipcMain.handle('open-path', async (_e, filePath) => {
  try {
    if (filePath && shell) {
      shell.showItemInFolder(filePath);
      return { success: true };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('show-notification', (_e, { title, body, catPayload }) => {
  const cleanTitle = title || 'MeowSheet';
  const cleanBody = body || '';

  // 1. Taskbar flash glow: tells user about new activity even when in another app
  if (win && !win.isDestroyed()) {
    win.flashFrame(true);
  }

  // 2. Heads-Up Display: Always-on-top floating banner sliding down on desktop
  showDesktopBannerOverlay({ title: cleanTitle, body: cleanBody, catPayload });

  // 3. Native Windows Notification: Logs to Action Center / notification history
  if (Notification && Notification.isSupported()) {
    const iconFile = fs.existsSync(cachedIconPath) ? cachedIconPath : path.join(__dirname, 'assets', 'gir-icon.png');

    // Windows Toast XML with scenario="reminder" forces Windows 10/11 Notification Manager
    // to pop up an interactive banner on screen and play the audio chime instead of
    // silently suppressing it into the Action Center.
    const toastXml = `
<toast scenario="reminder">
  <visual>
    <binding template="ToastGeneric">
      <text hint-maxLines="1">${escapeXml(cleanTitle)}</text>
      <text>${escapeXml(cleanBody)}</text>
      <image placement="appLogoOverride" src="${iconFile}"/>
    </binding>
  </visual>
  <audio src="ms-winsoundevent:Notification.Default"/>
</toast>
`.trim();

    let notif;
    try {
      notif = new Notification({
        title: cleanTitle,
        body: cleanBody,
        icon: iconFile,
        urgency: 'critical',
        timeoutType: 'default',
        silent: false,
        toastXml: toastXml
      });
    } catch {
      notif = new Notification({
        title: cleanTitle,
        body: cleanBody,
        icon: iconFile,
        urgency: 'critical',
        timeoutType: 'default',
        silent: false
      });
    }

    notif.on('click', () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        if (!win.isVisible()) win.show();
        win.focus();
      }
    });

    try {
      notif.show();
    } catch {
      try {
        const fallback = new Notification({
          title: cleanTitle,
          body: cleanBody,
          icon: iconFile,
          urgency: 'critical',
          timeoutType: 'default',
          silent: false
        });
        fallback.on('click', () => {
          if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            if (!win.isVisible()) win.show();
            win.focus();
          }
        });
        fallback.show();
      } catch {}
    }
  }
  return true;
});
ipcMain.handle('focus-app', () => {
  if (bannerWin && !bannerWin.isDestroyed()) {
    bannerWin.hide();
  }
  showAndFocusWindow();
});
ipcMain.handle('hide-banner', () => {
  if (bannerWin && !bannerWin.isDestroyed()) {
    bannerWin.hide();
  }
});
ipcMain.handle('is-window-focused', () => win && !win.isDestroyed() ? (win.isFocused() && !win.isMinimized() && win.isVisible()) : false);
ipcMain.handle('get-window-state', () => {
  if (!win || win.isDestroyed()) return { isFocused: false, isMinimized: true, isVisible: false, isActive: false };
  const isMinimized = win.isMinimized();
  const isVisible = win.isVisible();
  const isFocused = win.isFocused();
  const isActive = isFocused && !isMinimized && isVisible;
  return { isFocused, isMinimized, isVisible, isActive };
});
ipcMain.handle('updates-state', () => updateState);
ipcMain.handle('updates-check', async () => {
  if (!updater) return updateState;
  await updater.checkForUpdates().catch(error => reportUpdate({ status: 'error', message: `Update check failed: ${error.message}` }));
  return updateState;
});
ipcMain.handle('updates-download', async () => {
  if (!updater || updateState.status !== 'available') return updateState;
  reportUpdate({ status: 'downloading', percent: 0, message: 'Starting download…' });
  await updater.downloadUpdate().catch(error => reportUpdate({ status: 'error', message: `Download failed: ${error.message}` }));
  return updateState;
});
ipcMain.handle('updates-install', () => {
  if (!updater || updateState.status !== 'ready') return false;
  setImmediate(() => updater.quitAndInstall(false, true));
  return true;
});
ipcMain.handle('app-quit', () => {
  isQuitting = true;
  app.quit();
});
