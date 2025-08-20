import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vid2mp3', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startConvert: (payload: any) => ipcRenderer.invoke('start-convert', payload),
  onProgress: (cb: (evt: any) => void) => ipcRenderer.on('progress', (_e, data) => cb(data)),
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    save: (name: string, data: any) => ipcRenderer.invoke('presets:save', { name, data }),
    del: (name: string) => ipcRenderer.invoke('presets:del', name),
    export: (name: string) => ipcRenderer.invoke('presets:export', name),
    import: () => ipcRenderer.invoke('presets:import'),
    setDefault: (name: string) => ipcRenderer.invoke('presets:setDefault', name),
    getDefault: () => ipcRenderer.invoke('presets:getDefault'),
  },
  exportLogs: (content: string) => ipcRenderer.invoke('export-logs', { content }),
  queue: {
    pause: () => ipcRenderer.invoke('queue:pause'),
    resume: () => ipcRenderer.invoke('queue:resume'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (data: any) => ipcRenderer.invoke('settings:save', data),
  },
  // Utility for previewing output paths (simulate only)
  previewOutput: (payload: any) => ipcRenderer.invoke('preview-output', payload),
  resume: {
    get: () => ipcRenderer.invoke('resume:get'),
    set: (enabled: boolean) => ipcRenderer.invoke('resume:set', { enabled }),
    clear: () => ipcRenderer.invoke('resume:clear'),
  }
});

declare global {
  interface Window { vid2mp3: any }
}
