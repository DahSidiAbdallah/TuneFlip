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
  selectFiles: async () => {
    const files = await ipcRenderer.invoke('select-files');
    // Return as normal strings for UI, but encode when sending to backend
    return files;
  },
  selectFolder: async () => {
    const folder = await ipcRenderer.invoke('select-folder');
    return folder;
  },
  startConvert: (payload) => {
    // Encode all input/output paths as base64
    const patch = { ...payload };
    if (patch.inputs) patch.inputs = encodePaths(patch.inputs);
    if (patch.outDir) patch.outDir = encodePath(patch.outDir);
    return ipcRenderer.invoke('start-convert', patch);
  },
  onProgress: (cb) => ipcRenderer.on('progress', (_e, data) => cb(data)),
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    save: (name, options) => ipcRenderer.invoke('presets:save', { name, options }),
    delete: (name) => ipcRenderer.invoke('presets:delete', { name }),
  },
  exportLogs: (content) => ipcRenderer.invoke('export-logs', { content }),
  queue: {
    pause: () => ipcRenderer.invoke('queue:pause'),
    resume: () => ipcRenderer.invoke('queue:resume'),
  },
  // Add the missing settings API
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (data) => ipcRenderer.invoke('settings:save', data)
  },
  // Also add resume API
  resume: {
    get: () => ipcRenderer.invoke('resume:get'),
    set: (enabled) => ipcRenderer.invoke('resume:set', { enabled }),
    clear: () => ipcRenderer.invoke('resume:clear')
  }
});
