// ...existing code...
// ==== Utils for media file filtering & folder recursion ====
import { clipboard, shell, Notification, Tray, Menu, nativeImage } from 'electron';
const SUPPORTED_EXTS = new Set(['.mp3','.wav','.m4a','.aac','.flac','.ogg','.opus','.wma','.webm','.mp4','.mkv','.mov','.avi','.wmv']);
function isSupported(p: string) { return SUPPORTED_EXTS.has(path.extname(p).toLowerCase()); }
function walkDir(startPath: string, out: string[] = []) {
  const stats = fs.statSync(startPath);
  if (stats.isFile()) {
    if (isSupported(startPath)) out.push(startPath);
    return out;
  }
  if (stats.isDirectory()) {
    for (const name of fs.readdirSync(startPath)) {
      walkDir(path.join(startPath, name), out);
    }
  }
  return out;
}
// Expand any mix of files/folders to a flat supported file list
ipcMain.handle('fs:expandPaths', async (_e, paths) => {
  const out: string[] = [];
  for (const p of paths) {
    try { walkDir(p, out); } catch { /* ignore bad paths */ }
  }
  // Remove dupes
  return Array.from(new Set(out));
});

// 1) Open output folder / show file
ipcMain.handle('os:openPath', (_e, p) => shell.openPath(p));
ipcMain.handle('os:showItem', (_e, p) => shell.showItemInFolder(p));

// 2) System notification
ipcMain.handle('sys:notify', (_e, { title, body }) => {
  new Notification({ title: title || 'TuneFlip', body: body || '' }).show();
});

// 3) Window progress (taskbar/dock)
ipcMain.handle('sys:setProgress', (_e, val) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  // val in [0..1] or -1 for indeterminate, null to clear
  win.setProgressBar(val == null ? -1 : val);
});

// 4) Tray (optional)
let tray: Tray | null = null;
ipcMain.handle('sys:traySet', (_e, { visible, text, tooltip }) => {
  if (visible && !tray) {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'iconTemplate.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip(tooltip || 'TuneFlip');
    tray.setTitle(text || '');
    const menu = Menu.buildFromTemplate([
      { label: 'Show', click: () => BrowserWindow.getAllWindows()[0]?.show() },
      { label: 'Quit', click: () => app.quit() }
    ]);
    tray.setContextMenu(menu);
  } else if (!visible && tray) {
    tray.destroy();
    tray = null;
  } else if (tray) {
    if (tooltip != null) tray.setToolTip(tooltip);
    if (text != null) tray.setTitle(text);
  }
});

// 5) Presets storage & default (import/export)
const PRESETS_PATH = path.join(app.getPath('userData'), 'presets.json');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
function readJSON(p: string) { try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return {}; } }
function writeJSON(p: string, obj: any) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
ipcMain.handle('presets:list', () => readJSON(PRESETS_PATH));
ipcMain.handle('presets:save', (_e, {name, data}) => { if (!name) return; const all = readJSON(PRESETS_PATH); all[name] = data; writeJSON(PRESETS_PATH, all); });
ipcMain.handle('presets:del', (_e, name) => { const all = readJSON(PRESETS_PATH); delete all[name]; writeJSON(PRESETS_PATH, all); });
ipcMain.handle('presets:export', async (_e, name) => {
  const all = readJSON(PRESETS_PATH);
  if (!name || !all[name]) return;
  const res = await dialog.showSaveDialog({ filters:[{ name:'JSON', extensions:['json'] }], defaultPath:`${name}.json` });
  if (res.canceled || !res.filePath) return;
  fs.writeFileSync(res.filePath, JSON.stringify(all[name], null, 2));
});
ipcMain.handle('presets:import', async () => {
  const res = await dialog.showOpenDialog({ filters:[{ name:'JSON', extensions:['json'] }], properties:['openFile'] });
  if (res.canceled || !res.filePaths?.[0]) return;
  const data = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
  const name = path.parse(res.filePaths[0]).name;
  const all = readJSON(PRESETS_PATH); all[name] = data; writeJSON(PRESETS_PATH, all);
  return { name, data };
});
ipcMain.handle('presets:setDefault', (_e, name) => { const s = readJSON(SETTINGS_PATH); s.__defaultPreset = name || null; writeJSON(SETTINGS_PATH, s); });
ipcMain.handle('presets:getDefault', () => readJSON(SETTINGS_PATH).__defaultPreset || null);

// 6) Logs
const LOG_PATH = path.join(app.getPath('userData'), 'tuneflip.log');
function appendLog(line: string) { fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`); }
ipcMain.handle('logs:getRecent', () => { try { return fs.readFileSync(LOG_PATH, 'utf8'); } catch { return ''; } });
ipcMain.handle('logs:clear', () => { try { fs.unlinkSync(LOG_PATH); } catch {} });
ipcMain.handle('logs:copy', (_e, txt) => clipboard.writeText(txt || ''));

// 7) Queue pause / resume (bridge to your backend)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface GlobalThis { __queuePause?: () => void; __queueResume?: () => void; [key: string]: any; }
}
// Removed duplicate handlers for 'queue:pause' and 'queue:resume'.
// Add preview-output handler for output preview before conversion
ipcMain.handle('preview-output', async (_e, payload) => {
  console.log('[TuneFlip Debug] preview-output payload:', payload);
  const { inputs, outDir, options } = payload as { inputs: string[]; outDir: string; options: any };
  const template = options.template || '{basename}.mp3';
  const preview = (inputs || []).map(input => {
    const ext = path.extname(input).replace(/^\./, '');
    const basename = path.basename(input, path.extname(input));
    let outName = template.replace('{basename}', basename).replace('{ext}', ext);
    if (options.bitrateKbps) outName = outName.replace('{bitrate}', String(options.bitrateKbps));
    if (options.vbrLevel) outName = outName.replace('{vbr}', String(options.vbrLevel));
    return path.join(outDir, outName);
  });
  console.log('[TuneFlip Debug] preview-output result:', preview);
  return preview;
});
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { convertPaths } from '../lib/convert.js';
import fs from 'node:fs';

// ES module __dirname replacement
import { fileURLToPath } from 'node:url';
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

ipcMain.handle('queue:pause', () => { __paused = true; });
ipcMain.handle('queue:resume', () => { __paused = false; });

function isBase64(str: string) {
  return /^[A-Za-z0-9+/=]+$/.test(str) && str.length % 4 === 0;
}
function decodePath(p: string) {
  if (typeof p !== 'string') return p;
  if (isBase64(p)) {
    try {
      const decoded = Buffer.from(p, 'base64').toString('utf8');
      // Only accept if round-trips back to the same base64
      if (Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '') === p.replace(/=+$/, '')) {
        return decoded;
      }
    } catch {}
  }
  return p;
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

// Removed duplicate handlers for 'queue:pause' and 'queue:resume'.

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

// Removed duplicate handlers for 'presets:list' and 'presets:save'.

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
  const settings = readSettings();
  console.log('[TuneFlip Debug] settings:get path:', settingsFile());
  console.log('[TuneFlip Debug] settings:get result:', settings);
  return settings;
});
ipcMain.handle('settings:save', async (_e, payload) => {
  console.log('[TuneFlip Debug] settings:save path:', settingsFile());
  console.log('[TuneFlip Debug] settings:save payload:', payload);
  writeSettings(payload || {});
  return true;
});
// Resume controls
ipcMain.handle('resume:get', async () => ({ enabled: __resumeEnabled, queue: readQueue() }));
ipcMain.handle('resume:set', async (_e, { enabled }) => { __resumeEnabled = !!enabled; return true; });
ipcMain.handle('resume:clear', async () => { writeQueue({ pending: [], done: [], fail: [] }); return true; });
