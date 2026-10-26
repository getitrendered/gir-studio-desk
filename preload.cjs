const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desk', {
  read: () => ipcRenderer.invoke('read-store'),
  write: value => ipcRenderer.invoke('write-store', value),
  chooseWorkbook: () => ipcRenderer.invoke('choose-workbook'),
  print: () => ipcRenderer.invoke('print-invoice'),
  notify: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
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
