// CommonJS preload to ensure compatibility regardless of package.json type
const { contextBridge, ipcRenderer } = require('electron');

function encodePath(p) {
  if (typeof p !== 'string') return p;
  return Buffer.from(p, 'utf8').toString('base64');
}
function encodePaths(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(encodePath);
}
contextBridge.exposeInMainWorld('vid2mp3', {
  // --- Files / Folders ---
  selectFiles: async () => {
    const files = await ipcRenderer.invoke('select-files');
    return files;
  },
  selectFolder: async () => {
    const folder = await ipcRenderer.invoke('select-folder');
    return folder;
  },
  fs: {
    expandPaths: (paths) => ipcRenderer.invoke('fs:expandPaths', paths),
  },

  // --- Output folder opening ---
  os: {
    openPath: (p) => ipcRenderer.invoke('os:openPath', p),
    showItemInFolder: (p) => ipcRenderer.invoke('os:showItem', p),
  },

  // --- Queue controls ---
  queue: {
    pause: () => ipcRenderer.invoke('queue:pause'),
    resume: () => ipcRenderer.invoke('queue:resume'),
  },

  // --- Notifications / Tray ---
  sys: {
    notify: (payload) => ipcRenderer.invoke('sys:notify', payload),
    setProgress: (val) => ipcRenderer.invoke('sys:setProgress', val),
    traySet: (payload) => ipcRenderer.invoke('sys:traySet', payload),
  },

  // --- Presets import/export & default ---
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    save: (name, data) => ipcRenderer.invoke('presets:save', { name, data }),
    del: (name) => ipcRenderer.invoke('presets:del', name),
    export: (name) => ipcRenderer.invoke('presets:export', name),
    import: () => ipcRenderer.invoke('presets:import'),
    setDefault: (name) => ipcRenderer.invoke('presets:setDefault', name),
    getDefault: () => ipcRenderer.invoke('presets:getDefault'),
  },

  // --- Logs ---
  logs: {
    getRecent: () => ipcRenderer.invoke('logs:getRecent'),
    clear: () => ipcRenderer.invoke('logs:clear'),
    copyToClipboard: (txt) => ipcRenderer.invoke('logs:copy', txt),
  },

  // --- Conversion ---
  startConvert: (payload) => {
    const patch = { ...payload };
    if (patch.inputs) patch.inputs = encodePaths(patch.inputs);
    if (patch.outDir) patch.outDir = encodePath(patch.outDir);
    return ipcRenderer.invoke('start-convert', patch);
  },
  onProgress: (cb) => ipcRenderer.on('progress', (_e, data) => cb(data)),

  // --- Settings ---
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (data) => ipcRenderer.invoke('settings:save', data)
  },

  // --- Resume ---
  resume: {
    get: () => ipcRenderer.invoke('resume:get'),
    set: (enabled) => ipcRenderer.invoke('resume:set', { enabled }),
    clear: () => ipcRenderer.invoke('resume:clear')
  }
});
