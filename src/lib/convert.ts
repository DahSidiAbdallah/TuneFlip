import fg from 'fast-glob';
import { basename, dirname, extname, join, resolve, relative } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import pLimit from 'p-limit';
import chalk from 'chalk';
import { createConverter } from './ffmpeg.js';
import cliProgress from 'cli-progress';
import { randomBytes } from 'node:crypto';

export type ConvertOptions = {
  outDir: string;
  bitrateKbps?: number; // e.g., 192
  vbrLevel?: number;    // 0(best) - 9(worst)
  sampleRate?: number;  // e.g., 44100
  channels?: number;    // 1 or 2
  loudnorm?: boolean;   // EBU R128 loudness normalization
  trim?: string;        // 'start-end' seconds or 'start'
  concurrency?: number; // number of parallel conversions
  keepStructure?: boolean; // preserve directory structure under outDir
  overwrite?: boolean;  // overwrite existing outputs
  dryRun?: boolean;     // don't write files
  // Resource throttling: reduce CPU spikes for very large jobs
  throttle?: 'off' | 'medium' | 'low';
  throttleDelayMs?: number; // optional delay before starting each task
  // Metadata auto-detect and cover frame controls
  autoMeta?: boolean; // default true; detect title/artist/album via ffprobe/filename
  preferDetected?: boolean; // if true, auto-detected values override manual ones
  coverFrameSec?: number; // default 5s
  coverFrameRules?: Array<{ pattern: string; timeSec: number }>; // regex rules applied to basename
  // Optional GUI callbacks (when provided, progress bars are not created)
  onFileStart?: (info: { input: string; index: number; total: number; output: string }) => void;
  onFileProgress?: (info: { input: string; percent: number }) => void;
  onFileDone?: (info: { input: string; output: string; ok: boolean; error?: string }) => void;
  metadata?: {
    title?: string; artist?: string; album?: string; genre?: string; date?: string; track?: string; comment?: string;
    coverImagePath?: string;
  };
  // Output naming template e.g. "{basename}-{bitrate}k.mp3"; supports {basename},{ext},{vbr},{bitrate}
  template?: string;
  format?: string;
  // Auto extract a frame as cover if no cover provided
  autoCover?: { enabled: boolean; timeSec?: number };
  // Retry settings
  retry?: { attempts: number; delayMs?: number };
  // Optional controller to gate starting new tasks while paused
  controller?: { isPaused: () => boolean };
};

export type ConvertResult = {
  input: string;
  output?: string;
  ok: boolean;
  error?: string;
};

const VIDEO_EXTS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.flv', '.wmv', '.m4v', '.3gp'];
const AUDIO_EXTS = ['.mp3','.wav','.m4a','.aac','.flac','.ogg','.opus','.wma'];

function isMediaLike(path: string) {
  const ext = extname(path).toLowerCase();
  return VIDEO_EXTS.includes(ext) || AUDIO_EXTS.includes(ext);
}

function parseTrim(trim?: string): { start?: number; end?: number } {
  if (!trim) return {};
  const [s, e] = trim.split('-');
  const start = s ? Number(s) : undefined;
  const end = e ? Number(e) : undefined;
  if (Number.isNaN(start!) || (e && Number.isNaN(end!))) {
    throw new Error('Invalid --trim format. Use start-end (seconds) or start');
  }
  return { start, end };
}

function detectFromFilename(fileBase: string): { title?: string; artist?: string } {
  // Strip common noise in parentheses/brackets after splitting
  const scrub = (s: string) => s
    .replace(/\s*(?:\(|\[|\{).*?(?:\)|\]|\})\s*/g, ' ')
    .replace(/\b(official\s*video|official\s*audio|lyrics|audio\s*only|hd|4k|remaster(?:ed)?|mv|clip)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Try Artist - Title
  let m = fileBase.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (m) {
    const artist = scrub(m[1]);
    const title = scrub(m[2]);
    if (artist && title) return { artist, title };
  }
  // Try Title by Artist
  m = fileBase.match(/^(.+?)\s+by\s+(.+)$/i);
  if (m) {
    const title = scrub(m[1]);
    const artist = scrub(m[2]);
    if (artist && title) return { artist, title };
  }
  // Try Artist _ Title
  m = fileBase.match(/^(.+?)\s*_\s*(.+)$/);
  if (m) {
    const artist = scrub(m[1]);
    const title = scrub(m[2]);
    if (artist && title) return { artist, title };
  }
  // Fallback: if contains dash later, split
  const parts = fileBase.split(/\s*[-–]\s*/);
  if (parts.length === 2) {
    const artist = scrub(parts[0]);
    const title = scrub(parts[1]);
    if (artist && title) return { artist, title };
  }
  return {};
}

function tempCoverPath(outDir: string, suffix: string) {
  const rand = randomBytes(6).toString('hex');
  return join(outDir, `.tf-${rand}${suffix}`);
}

async function convertPaths(inputs: string[], opts: ConvertOptions): Promise<ConvertResult[]> {
  // Make concurrency configurable and safe for very large queues; apply throttle caps
  const baseConc = Math.max(1, Math.min(64, opts.concurrency ?? Math.max(1, Math.floor(os.cpus().length / 2))));
  let concurrency = baseConc;
  if (opts.throttle === 'low') concurrency = Math.min(concurrency, 1);
  else if (opts.throttle === 'medium') concurrency = Math.min(concurrency, 2);
  const useBars = !(opts.onFileStart || opts.onFileProgress || opts.onFileDone);
  const bar = useBars ? new cliProgress.MultiBar({
    format: '{bar} {percentage}% | {value}/{total} | {filename}',
    hideCursor: true,
    clearOnComplete: false,
    autopadding: true,
  }, cliProgress.Presets.shades_grey) : null;

  // Accept both direct file paths (absolute/relative) and glob patterns
  // Consider only typical glob tokens; do NOT treat parentheses alone as glob
  const isGlob = (s: string) => /[\*\?\[\]\{\}!]/.test(s);
  const direct: string[] = [];
  const patterns: string[] = [];
  for (const inp of inputs) {
    if (!inp) continue;
    const abs = inp.startsWith('\\\\') || inp.match(/^[a-zA-Z]:\\/)
      ? inp
      : resolve(process.cwd(), inp);
    // If it exists as a file, always treat as direct regardless of glob-like characters
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) { direct.push(abs); continue; }
    if (isGlob(inp)) patterns.push(inp);
  }
  const globbed: string[] = patterns.length
    ? await fg(patterns, { absolute: true, onlyFiles: true, unique: true, suppressErrors: true }) as unknown as string[]
    : [];
  const all = Array.from(new Set([...direct, ...globbed]));
  const candidates = all.filter((p: string) => isMediaLike(p));

  if (candidates.length === 0) {
    console.log(chalk.yellow('No supported files matched.'));
    return [];
  }

  const limiter = pLimit(concurrency);
  const conv = await createConverter();
  const trimRange = parseTrim(opts.trim);

  const total = candidates.length;
  let idxCounter = 0;
  const waitIfPaused = async () => { while (opts.controller?.isPaused && opts.controller.isPaused()) await new Promise(r=>setTimeout(r,100)); };

  const tasks = candidates.map((input: string) => limiter(async () => {
    const base = basename(input, extname(input));
  const relDir = opts.keepStructure ? relative(process.cwd(), dirname(input)) : '';
    const outDir = resolve(opts.outDir, relDir);
  const tpl = (opts.template || '{basename}.mp3')
      .replace('{basename}', base)
      .replace('{ext}', extname(input).replace(/^\./,''))
      .replace('{bitrate}', String(opts.bitrateKbps ?? ''))
      .replace('{vbr}', typeof opts.vbrLevel === 'number' ? String(opts.vbrLevel) : '');
    // Determine output extension based on opts.format
    let extOut = '.mp3';
    if (opts.format) {
      extOut = opts.format === 'aac' ? '.m4a' : `.${opts.format}`;
    }
    // Remove any existing extension from template and add new one
    const baseName = tpl.replace(/\.[^\.]+$/, '');
    const out = join(outDir, baseName + extOut);

    if (!opts.dryRun) fs.mkdirSync(outDir, { recursive: true });

  if (!opts.overwrite && fs.existsSync(out)) {
      return { input, output: out, ok: true } as ConvertResult;
    }

    const index = idxCounter++;
    if (opts.onFileStart) {
      opts.onFileStart({ input, index, total, output: out });
    }
    const barInst = useBars && bar ? bar.create(100, 0, { filename: basename(input) }) : null;

    try {
      await waitIfPaused();
      if (opts.throttleDelayMs && opts.throttleDelayMs > 0) {
        await new Promise(r=>setTimeout(r, opts.throttleDelayMs));
      }
      if (opts.dryRun) {
        if (barInst) { barInst.update(100); barInst.stop(); }
        if (opts.onFileDone) opts.onFileDone({ input, output: out, ok: true });
        return { input, output: out, ok: true };
      }
      // Auto-detect tags via ffprobe and extract cover if available
      let coverPath = opts.metadata?.coverImagePath;
      let tempCover: string | undefined;
      let autoTags: Record<string,string> = {};
      try {
        const { tags, attachedPicStreamIndex } = await (conv as any).probeTags?.(input) || { tags: {} };
        autoTags = tags || {};
        if (!coverPath && typeof attachedPicStreamIndex === 'number') {
          const tmp = tempCoverPath(outDir, '.cover.attached.jpg');
          try { await (conv as any).extractAttachedPicture?.(input, attachedPicStreamIndex, tmp); if (fs.existsSync(tmp)) { coverPath = tmp; tempCover = tmp; } } catch {}
        }
      } catch {}
      // Filename-based guess if enabled
      const allowAuto = opts.autoMeta !== false; // default true
      let fileNameTags: Record<string,string> = {};
      if (allowAuto) {
        const guess = detectFromFilename(base);
        if (guess.artist) fileNameTags.artist = guess.artist;
        if (guess.title) fileNameTags.title = guess.title;
      }
      // Fallback: extract a frame if no attached pic found
      if (!coverPath) {
        // Apply per-file cover frame rules
        let tSec = opts.coverFrameSec ?? opts.autoCover?.timeSec ?? 5;
        if (opts.coverFrameRules && opts.coverFrameRules.length) {
          for (const r of opts.coverFrameRules) {
            try { if (new RegExp(r.pattern, 'i').test(base)) { tSec = r.timeSec; break; } } catch {}
          }
        }
        const tmp = tempCoverPath(outDir, '.cover.jpg');
        try { await conv.extractFrame(input, tSec, tmp); if (fs.existsSync(tmp)) { coverPath = tmp; tempCover = tmp; } }
        catch {/* ignore */}
      }

    // Select encoder based on output extension
    const extLower = extOut.toLowerCase();
    let convertFn;
    if (extLower === '.m4a' || extLower === '.aac') convertFn = conv.toAac;
    else if (extLower === '.flac') convertFn = conv.toFlac;
    else if (extLower === '.ogg') convertFn = conv.toOgg;
    else if (extLower === '.opus') convertFn = conv.toOpus;
    else convertFn = conv.toMp3;
    const attempt = async () => convertFn({
      input,
      output: out,
      bitrateKbps: opts.bitrateKbps,
      vbrLevel: opts.vbrLevel,
      sampleRate: opts.sampleRate,
      channels: opts.channels,
      threads: opts.throttle === 'low' ? 1 : (opts.throttle === 'medium' ? 2 : undefined),
      loudnorm: !!opts.loudnorm,
      trim: trimRange,
      metadata: ((preferDetected) => {
        const detected = {
          title: autoTags.title || autoTags['itl'] || autoTags['tracktitle'] || fileNameTags.title,
          artist: autoTags.artist || autoTags['album_artist'] || autoTags['author'] || fileNameTags.artist,
          album: autoTags.album,
          genre: autoTags.genre,
          date: autoTags.date || autoTags.year,
          track: autoTags.track,
          comment: autoTags.comment || autoTags.description,
        } as Record<string,string|undefined>;
        const manual = opts.metadata || {};
        const merged: any = {};
        const keys = ['title','artist','album','genre','date','track','comment'] as const;
        for (const k of keys) {
          merged[k] = preferDetected ? (detected[k] ?? manual[k]) : (manual[k] ?? detected[k]);
        }
        merged.coverImagePath = coverPath;
        return merged;
      })(opts.preferDetected === true),
      onProgress: (p: number) => {
        if (barInst) barInst.update(Math.min(99, Math.max(1, Math.round(p))));
        if (opts.onFileProgress) opts.onFileProgress({ input, percent: p });
      }
    });

      const attempts = Math.max(1, opts.retry?.attempts ?? 1);
      let okRun = false; let lastErr: any;
      for (let i=0;i<attempts;i++) {
        try { await attempt(); okRun = true; break; }
        catch (e) { lastErr = e; if (opts.retry?.delayMs) await new Promise(r=>setTimeout(r, opts.retry!.delayMs)); }
      }
      if (!okRun) throw lastErr;
      if (tempCover) { try { fs.unlinkSync(tempCover); } catch {} }
      if (barInst) { barInst.update(100); barInst.stop(); }
      if (opts.onFileDone) opts.onFileDone({ input, output: out, ok: true });
      return { input, output: out, ok: true };
    } catch (e: any) {
      if (barInst) barInst.stop();
      // Log error to terminal for developer diagnosis
      console.error(`\n[FFMPEG ERROR] Failed to convert: ${input}`);
      if (e && e.stack) {
        console.error(e.stack);
      } else if (e && e.message) {
        console.error(e.message);
      } else {
        console.error(e);
      }
      if (opts.onFileDone) opts.onFileDone({ input, output: out, ok: false, error: e?.message || String(e) });
      return { input, output: out, ok: false, error: e?.message || String(e) };
    }
  }));

  const results = await Promise.all(tasks);
  if (bar) bar.stop();
  return results;
}

// Simple controller for GUI to pause/resume
export function createController() {
  let paused = false;
  return {
    pause(){ paused = true; },
    resume(){ paused = false; },
    get paused(){ return paused; }
  };
}

export { convertPaths };
