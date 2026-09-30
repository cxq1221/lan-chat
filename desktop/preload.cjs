const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('host', {
  state: () => ipcRenderer.invoke('state'),
  copy: address => ipcRenderer.invoke('copy', address),
  open: () => ipcRenderer.invoke('open-chat'),
  data: () => ipcRenderer.invoke('open-data'),
  quit: () => ipcRenderer.invoke('quit')
});
