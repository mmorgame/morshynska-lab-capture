const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('morshynskaAPI', {
  getSources: () => ipcRenderer.invoke('get-capture-sources'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (partial) => ipcRenderer.invoke('save-config', partial),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  selectFolder: (kind) => ipcRenderer.invoke('select-folder', kind),
  selectWatermarkImage: () => ipcRenderer.invoke('select-watermark-image'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  saveRecordingChunk: (buffer) => ipcRenderer.invoke('save-recording-chunk', buffer),
  startRecordingSession: (opts) => ipcRenderer.invoke('start-recording-session', opts),
  finalizeRecordingSession: (opts) => ipcRenderer.invoke('finalize-recording-session', opts),
  saveScreenshotFile: (payload) => ipcRenderer.invoke('save-screenshot-file', payload),
  triggerCopyOverlay: () => ipcRenderer.invoke('trigger-copy-overlay'),
  updateHudState: (data) => ipcRenderer.send('update-hud-state', data),
  beginRebindCapture: (action) => ipcRenderer.invoke('begin-rebind-capture', action),
  rebindHotkey: (action, accelerator) => ipcRenderer.invoke('rebind-hotkey', { action, accelerator }),
  onHotkeyRebound: (cb) => ipcRenderer.on('hotkey-rebound', (_e, data) => cb(data)),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  windowControl: (cmd) => ipcRenderer.send('window-control', cmd),
  onGlobalAction: (cb) => ipcRenderer.on('global-action', (_e, data) => cb(data)),
  onCopyCompleted: (cb) => ipcRenderer.on('copy-completed', (_e, data) => cb(data)),
  onRecordingStatus: (cb) => ipcRenderer.on('recording-status', (_e, data) => cb(data))
});
