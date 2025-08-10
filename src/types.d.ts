// Minimal ambient types to allow building without @types/node when offline
declare const process: any;
declare module 'node:*';

declare module 'chalk' {
  const chalk: any;
  export default chalk;
}
declare module 'cli-progress' {
  const mod: any;
  export default mod;
}
declare module 'fast-glob' {
  const fg: any;
  export default fg;
}
declare module 'p-limit' {
  const pLimit: any;
  export default pLimit;
}
declare module 'fluent-ffmpeg' {
  const ffmpeg: any;
  export default ffmpeg;
}
declare module 'ffmpeg-static' {
  const path: string;
  export default path;
}
declare module 'ffprobe-static' {
  export const path: string;
}

declare module 'electron' {
  export const app: any;
  export const BrowserWindow: any;
  export const ipcMain: any;
  export const dialog: any;
  export const contextBridge: any;
  export const ipcRenderer: any;
}

// Allow TS to accept relative ESM imports ending with .js from TS sources
declare module './lib/convert.js' {
  export const convertPaths: any;
  export const createController: any;
}
declare module './ffmpeg.js' {
  export const createConverter: any;
}
// Fallback for any ESM .js import from TS during type-check
declare module '*.js';
