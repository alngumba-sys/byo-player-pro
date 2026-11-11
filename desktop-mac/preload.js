const { contextBridge, ipcRenderer } = require('electron');
const info = ipcRenderer.sendSync('byo-desktop');
contextBridge.exposeInMainWorld('ByoDesktop', { base: info.base, version: info.version, platform: info.platform, arch: info.arch });
