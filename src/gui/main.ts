import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertPaths } from '../lib/convert.js';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const iconPath = path.resolve(__dirname, '../../images/logo.png');
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    webPreferences: {
      // Use CommonJS preload for reliability under ESM app
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
    title: 'TuneFlip',
    icon: iconPath,
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('select-files', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('select-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return res.canceled ? '' : res.filePaths[0];
});

let __paused = false;
let __resumeEnabled = true;

function queueFile() {
  return path.join(app.getPath('userData'), 'queue.json');
}
function readQueue(): { pending: string[]; done: string[]; fail: string[] } {
  try {
    const p = queueFile();
    if (!fs.existsSync(p)) return { pending: [], done: [], fail: [] };
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { pending: j.pending||[], done: j.done||[], fail: j.fail||[] };
  } catch { return { pending: [], done: [], fail: [] }; }
}
function writeQueue(q: { pending: string[]; done: string[]; fail: string[] }) {
  const p = queueFile();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(q, null, 2), 'utf8');
}

function decodePath(p: string) {
  if (typeof p !== 'string') return p;
  try {
    const decoded = Buffer.from(p, 'base64').toString('utf8');
    console.log('[TuneFlip Main] Decoding base64 path:', p, '->', decoded);
    return decoded;
  } catch {
    console.log('[TuneFlip Main] Failed to decode base64 path:', p);
    return p;
  }
}
function decodePaths(arr: any) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(decodePath);
}
ipcMain.handle('start-convert', async (e, payload) => {
  let { inputs, outDir, options } = payload as { inputs: string[]; outDir: string; options: any };

  // Decode base64-encoded paths
  inputs = decodePaths(inputs);
  outDir = decodePath(outDir);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const controller = { isPaused: () => __paused };
  // Merge with resume queue if enabled
  const baseInputs: string[] = Array.isArray(inputs) ? inputs : [];
  let workingInputs = baseInputs;
  if (__resumeEnabled) {
    const q = readQueue();
    const merged = Array.from(new Set([...(q.pending||[]), ...baseInputs]));
    workingInputs = merged;
    writeQueue({ pending: merged, done: q.done||[], fail: q.fail||[] });
  }

  // Log all input/output paths for debugging
  console.log('TuneFlip conversion request:');
  console.log('  Inputs:', workingInputs);
  console.log('  Output directory:', outDir);
  console.log('  Options:', options);

  const results = await convertPaths(workingInputs, {
    outDir,
    bitrateKbps: options.bitrateKbps,
    vbrLevel: options.vbrLevel,
    sampleRate: options.sampleRate,
    channels: options.channels,
    loudnorm: !!options.loudnorm,
    trim: options.trim,
    concurrency: options.concurrency,
    throttle: options.throttle,
    throttleDelayMs: options.throttleDelayMs,
    autoMeta: options.autoMeta,
    preferDetected: options.preferDetected,
    coverFrameSec: options.coverFrameSec,
    coverFrameRules: options.coverFrameRules,
    keepStructure: !!options.keepStructure,
    overwrite: !!options.overwrite,
    dryRun: !!options.dryRun,
    template: options.template,
    autoCover: options.autoCover,
    metadata: options.metadata,
    retry: options.retry,
    controller,
    onFileStart: (info) => {
      console.log('[TuneFlip] Starting conversion:', info.input, '->', info.output);
      e.sender.send('progress', { type: 'start', ...info });
    },
    onFileProgress: (info) => {
      e.sender.send('progress', { type: 'progress', ...info });
    },
    onFileDone: (info) => {
      if (!info.ok) {
        console.error('[TuneFlip] Conversion failed:', info.input, '->', info.output, '\nError:', info.error);
      } else {
        console.log('[TuneFlip] Conversion succeeded:', info.input, '->', info.output);
      }
      if (__resumeEnabled) {
        const q = readQueue();
        const pending = (q.pending||[]).filter(p=>p!==info.input);
        const done = [...(q.done||[]),(info.ok?info.input:undefined)].filter(Boolean) as string[];
        const fail = [...(q.fail||[]),(!info.ok?info.input:undefined)].filter(Boolean) as string[];
        writeQueue({ pending, done, fail });
      }
      e.sender.send('progress', { type: 'done', ...info });
    },
  });
  return { results };
});

ipcMain.handle('queue:pause', () => { __paused = true; return true; });
ipcMain.handle('queue:resume', () => { __paused = false; return true; });

ipcMain.handle('export-logs', async (_e, { content }) => {
  const res = await dialog.showSaveDialog({ filters: [{ name: 'Text', extensions: ['txt','log']}] });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, content || '', 'utf8');
  return true;
});

// Presets stored in userData/presets.json
function presetsFile() {
  return path.join(app.getPath('userData'), 'presets.json');
}
function readPresets(): Record<string, any> {
  try {
    const p = presetsFile();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return {}; }
}
function writePresets(data: Record<string, any>) {
  const p = presetsFile();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

ipcMain.handle('presets:list', async () => {
  return readPresets();
});
ipcMain.handle('presets:save', async (_e, { name, options }) => {
  const all = readPresets();
  all[name] = options;
  writePresets(all);
  return true;
});

// Settings stored in userData/settings.json
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function readSettings(): Record<string, any> {
  try {
    const p = settingsFile();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return {}; }
}
function writeSettings(data: Record<string, any>) {
  const p = settingsFile();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

ipcMain.handle('settings:get', async () => {
  return readSettings();
});
ipcMain.handle('settings:save', async (_e, payload) => {
  writeSettings(payload || {});
  return true;
});
ipcMain.handle('presets:delete', async (_e, { name }) => {
  const all = readPresets();
  delete all[name];
  writePresets(all);
  return true;
});

// Resume controls
ipcMain.handle('resume:get', async () => ({ enabled: __resumeEnabled, queue: readQueue() }));
ipcMain.handle('resume:set', async (_e, { enabled }) => { __resumeEnabled = !!enabled; return true; });
ipcMain.handle('resume:clear', async () => { writeQueue({ pending: [], done: [], fail: [] }); return true; });
