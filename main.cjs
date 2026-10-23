const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
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

let win;
let updater;
let updateState = { status: 'unavailable', version: app.getVersion(), message: 'Install a release build to receive updates.' };
const file = () => path.join(app.getPath('userData'), 'ledger.json');
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
  win = new BrowserWindow({ width: 1600, height: 980, minWidth: 1080, minHeight: 660, show: false,
    backgroundColor: '#f7f8fa', title: 'MeowSheet', icon: path.join(__dirname, 'assets', 'gir-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { win.show(); reportUpdate({}); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
app.whenReady().then(() => { createWindow(); initUpdates(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
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
ipcMain.handle('show-notification', (_e, { title, body }) => {
  if (Notification && Notification.isSupported()) {
    new Notification({
      title: title || 'MeowSheet',
      body: body || '',
      icon: path.join(__dirname, 'assets', 'gir-icon.png')
    }).show();
    return true;
  }
  return false;
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
