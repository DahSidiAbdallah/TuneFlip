import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';
import ffmpeg from 'fluent-ffmpeg';
import os from 'node:os';

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
    return new Promise((resolve) => {
      ffmpeg.ffprobe(input, (err: Error | undefined, data: any) => {
        if (err || !data) return resolve({ tags: {} });
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
      ffmpeg()
        .input(input)
  .outputOptions(['-map', `0:${streamIndex}`, '-frames:v', '1'])
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });
  }
  async function extractFrame(input: string, timeSec: number, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(input)
        .seekInput(Math.max(0, timeSec))
        .outputOptions(['-frames:v', '1'])
        .output(outPath)
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
      ffmpeg()
        .input(input)
        .audioFilters(filter)
    .outputOptions(['-f', 'null'])
    .output(os.platform() === 'win32' ? 'NUL' : '/dev/null')
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
    let cmd = ffmpeg().input(input);
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
        if (md.title) outOpts.push('-metadata', `title=${md.title}`);
        if (md.artist) outOpts.push('-metadata', `artist=${md.artist}`);
        if (md.album) outOpts.push('-metadata', `album=${md.album}`);
        if (md.genre) outOpts.push('-metadata', `genre=${md.genre}`);
        if (md.date) outOpts.push('-metadata', `date=${md.date}`);
        if (md.track) outOpts.push('-metadata', `track=${md.track}`);
        if (md.comment) outOpts.push('-metadata', `comment=${md.comment}`);
        if (md.coverImagePath) {
          cmd = cmd.input(md.coverImagePath);
          outOpts.push('-map', '1', '-id3v2_version', '3');
        } else {
          outOpts.push('-id3v2_version', '3');
        }
      }

      cmd = cmd.outputOptions(outOpts);

      cmd
  .on('progress', (p: { percent?: number }) => {
          if (onProgress && p.percent != null) onProgress(p.percent);
        })
  .on('end', () => resolve())
  .on('error', (err: Error) => reject(err))
        .save(output);
    });
  }

  return { toMp3, extractFrame, probeTags, extractAttachedPicture };
}
