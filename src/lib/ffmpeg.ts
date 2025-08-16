import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';
import ffmpeg from 'fluent-ffmpeg';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { getShortPathIfAscii } from './shortpath.js';

ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);
ffmpeg.setFfprobePath(ffprobePath.path);

export type ToMp3Options = {
  input: string;
  output: string;
  bitrateKbps?: number;
  vbrLevel?: number; // 0-9
  sampleRate?: number;
  channels?: number;
  loudnorm?: boolean;
  trim?: { start?: number; end?: number };
  onProgress?: (percent: number) => void;
  metadata?: {
    title?: string; artist?: string; album?: string; genre?: string; date?: string; track?: string; comment?: string;
    coverImagePath?: string; // optional image file to embed as album art
  };
  threads?: number; // optional ffmpeg threads override
};

export function createConverter() {
  async function probeTags(input: string): Promise<{
    tags: Record<string, string>;
    attachedPicStreamIndex?: number;
  }> {
    // Check if file exists and is not empty
    try {
      const stats = fs.statSync(input);
      if (stats.size === 0) {
        throw new Error('Input file is empty (0 bytes)');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('ENOENT')) {
        throw new Error(`Input file not found: ${input}`);
      }
      throw err;
    }

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(getShortPathIfAscii(path.resolve(input)), (err: Error | undefined, data: any) => {
        if (err) {
          if (err.message.includes('Invalid data found when processing input')) {
            reject(new Error(`Invalid or corrupted video file: ${input}. The file may be empty or in an unsupported format.`));
            return;
          }
          reject(err);
          return;
        }
        if (!data) {
          resolve({ tags: {} });
          return;
        }
        const tags: Record<string, string> = {};
        const fmtTags = (data.format as any)?.tags || {};
        const candidates = [fmtTags, ...((data.streams||[]).map((s:any)=>s.tags||{}))];
        for (const t of candidates) {
          for (const [k, v] of Object.entries(t)) {
            const key = String(k).toLowerCase();
            if (typeof v === 'string') {
              if (!tags[key]) tags[key] = v;
            }
          }
        }
        let attachedPicStreamIndex: number | undefined;
        for (let i=0;i<(data.streams||[]).length;i++) {
          const s:any = (data.streams||[])[i];
          if (s?.disposition?.attached_pic) { attachedPicStreamIndex = i; break; }
        }
        resolve({ tags, attachedPicStreamIndex });
      });
    });
  }

  async function extractAttachedPicture(input: string, streamIndex: number, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = ffmpeg()
        .input(getShortPathIfAscii(path.resolve(input)))
        .outputOptions(['-map', `0:${streamIndex}`, '-frames:v', '1'])
        .output(getShortPathIfAscii(path.resolve(outPath)));
      if (process.platform === 'win32' && (cmd as any).setSpawnOptions) {
        (cmd as any).setSpawnOptions({ windowsVerbatimArguments: true });
      }
      cmd
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });
  }
  async function extractFrame(input: string, timeSec: number, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = ffmpeg()
        .input(getShortPathIfAscii(path.resolve(input)))
        .seekInput(Math.max(0, timeSec))
        .outputOptions(['-frames:v', '1'])
        .output(getShortPathIfAscii(path.resolve(outPath)));
      if (process.platform === 'win32' && (cmd as any).setSpawnOptions) {
        (cmd as any).setSpawnOptions({ windowsVerbatimArguments: true });
      }
      cmd
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });
  }
  async function measureLoudness(input: string): Promise<{measured_I?: number; measured_TP?: number; measured_LRA?: number; measured_thresh?: number}> {
    // Use ffmpeg loudnorm print_format=json pass1 to get stats
    const filter = 'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-99:measured_TP=-99:measured_LRA=-99:measured_thresh=-99:print_format=json';
  return new Promise((resolve, reject) => {
      let json = '';
      const cmd = ffmpeg()
        .input(getShortPathIfAscii(path.resolve(input)))
        .audioFilters(filter)
        .outputOptions(['-f', 'null'])
        .output(os.platform() === 'win32' ? 'NUL' : '/dev/null');
      if (process.platform === 'win32' && (cmd as any).setSpawnOptions) {
        (cmd as any).setSpawnOptions({ windowsVerbatimArguments: true });
      }
      cmd
        .on('stderr', (line: string) => {
          // ffmpeg prints JSON to stderr for filters
          json += line + '\n';
        })
        .on('end', () => {
          // Try to extract JSON block
          const start = json.indexOf('{');
          const end = json.lastIndexOf('}');
          if (start !== -1 && end !== -1) {
            try {
              const obj = JSON.parse(json.slice(start, end + 1));
              resolve(obj);
            } catch {
              resolve({});
            }
          } else {
            resolve({});
          }
        })
        .on('error', (err: Error) => reject(err))
        .run();
    });
  }

  function buildBase(input: string, opts: ToMp3Options) {
  let cmd = ffmpeg().input(getShortPathIfAscii(path.resolve(input)));
    if (process.platform === 'win32' && (cmd as any).setSpawnOptions) {
      (cmd as any).setSpawnOptions({ windowsVerbatimArguments: true });
    }
    if (opts.trim?.start != null) cmd = cmd.setStartTime(opts.trim.start);
    if (opts.trim?.end != null && opts.trim.start != null) {
      const dur = Math.max(0, opts.trim.end - opts.trim.start);
      cmd = cmd.duration(dur);
    } else if (opts.trim?.end != null) {
      cmd = cmd.duration(Math.max(0, opts.trim.end));
    }
    return cmd;
  }

  async function toMp3(opts: ToMp3Options) {
    const { input, output, vbrLevel, bitrateKbps, sampleRate, channels, loudnorm, onProgress } = opts;

    // Check if input file exists and is not empty
    try {
      const stats = fs.statSync(input);
      if (stats.size === 0) {
        throw new Error('Input file is empty (0 bytes)');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('ENOENT')) {
        throw new Error(`Input file not found: ${input}`);
      }
      throw err;
    }

    const pass2Loudnorm = loudnorm ? await measureLoudness(input) : undefined;

    await new Promise<void>((resolve, reject) => {
      let cmd = buildBase(input, opts)
        .audioCodec('libmp3lame');

      if (typeof vbrLevel === 'number') {
        const q = Math.min(9, Math.max(0, vbrLevel));
        cmd = cmd.audioQuality(q);
      } else if (typeof bitrateKbps === 'number') {
        cmd = cmd.audioBitrate(`${Math.max(32, bitrateKbps)}k`);
      } else {
        // sensible default
        cmd = cmd.audioBitrate('192k');
      }

      if (sampleRate) cmd = cmd.audioFrequency(sampleRate);
      if (channels) cmd = cmd.audioChannels(channels);

      if (loudnorm) {
        const ln = pass2Loudnorm || {};
        const filter = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${ln.measured_I ?? -16}:measured_TP=${ln.measured_TP ?? -1.5}:measured_LRA=${ln.measured_LRA ?? 11}:measured_thresh=${ln.measured_thresh ?? -26}:linear=true:print_format=summary`;
        cmd = cmd.audioFilters(filter);
      }

      const outOpts: string[] = ['-map_metadata', '0'];
      if (typeof opts.threads === 'number' && opts.threads > 0) {
        outOpts.push('-threads', String(opts.threads));
      }

      // ID3 metadata
      if (opts.metadata) {
        const md = opts.metadata;
        if (md.title) cmd = cmd.outputOption('-metadata', `title=${md.title}`);
        if (md.artist) cmd = cmd.outputOption('-metadata', `artist=${md.artist}`);
        if (md.album) cmd = cmd.outputOption('-metadata', `album=${md.album}`);
        if (md.genre) cmd = cmd.outputOption('-metadata', `genre=${md.genre}`);
        if (md.date) cmd = cmd.outputOption('-metadata', `date=${md.date}`);
        if (md.track) cmd = cmd.outputOption('-metadata', `track=${md.track}`);
        if (md.comment) cmd = cmd.outputOption('-metadata', `comment=${md.comment}`);
        if (md.coverImagePath) {
          cmd = cmd.input(getShortPathIfAscii(md.coverImagePath));
          outOpts.push('-map', '0:a', '-map', '1', '-c:v', 'copy', '-disposition:v:1', 'attached_pic', '-id3v2_version', '3');
        } else {
          outOpts.push('-map', '0:a', '-id3v2_version', '3');
        }
      }

  cmd = cmd.outputOptions(outOpts);

      cmd
        .on('progress', (p: { percent?: number }) => {
          if (onProgress && p.percent != null) onProgress(p.percent);
        })
        .on('end', () => resolve())
        .on('error', (err: Error) => {
          // Improve error messages for common issues
          if (err.message.includes('Invalid data found when processing input')) {
            reject(new Error(`Invalid or corrupted video file: ${input}. The file may be empty or in an unsupported format.`));
          } else {
            // Add more detailed error information
            reject(new Error(`FFmpeg error: ${err.message}. Input: ${input}, Output: ${output}`));
          }
        })
        // Capture stderr for more detailed error information
        .on('stderr', (stderrLine: string) => {
          // Log stderr for debugging
          console.error(`[FFMPEG STDERR] ${stderrLine}`);
        })
  .save(getShortPathIfAscii(path.resolve(output)));
    });
  }

  return { toMp3, extractFrame, probeTags, extractAttachedPicture };
}
