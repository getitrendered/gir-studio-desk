const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desk', {
  read: () => ipcRenderer.invoke('read-store'),
  write: value => ipcRenderer.invoke('write-store', value),
  chooseWorkbook: () => ipcRenderer.invoke('choose-workbook'),
  print: () => ipcRenderer.invoke('print-invoice'),
  notify: (title, body, catPayload) => ipcRenderer.invoke('show-notification', { title, body, catPayload }),
  focusApp: () => ipcRenderer.invoke('focus-app'),
  hideBanner: () => ipcRenderer.invoke('hide-banner'),
  onDisplayBanner: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('display-banner', listener);
    return () => ipcRenderer.removeListener('display-banner', listener);
  },
  onHideBanner: callback => {
    const listener = () => callback();
    ipcRenderer.on('hide-banner', listener);
    return () => ipcRenderer.removeListener('hide-banner', listener);
  },
  isFocused: () => ipcRenderer.invoke('is-window-focused'),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  quit: () => ipcRenderer.invoke('app-quit'),
  updates: {
    state: () => ipcRenderer.invoke('updates-state'),
    check: () => ipcRenderer.invoke('updates-check'),
    download: () => ipcRenderer.invoke('updates-download'),
    install: () => ipcRenderer.invoke('updates-install'),
    onChange: callback => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('update-state', listener);
      return () => ipcRenderer.removeListener('update-state', listener);
    }
  }
});
