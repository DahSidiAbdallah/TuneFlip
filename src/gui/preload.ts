import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vid2mp3', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startConvert: (payload: any) => ipcRenderer.invoke('start-convert', payload),
  onProgress: (cb: (evt: any) => void) => ipcRenderer.on('progress', (_e, data) => cb(data)),
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    save: (name: string, options: any) => ipcRenderer.invoke('presets:save', { name, options }),
    delete: (name: string) => ipcRenderer.invoke('presets:delete', { name }),
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
