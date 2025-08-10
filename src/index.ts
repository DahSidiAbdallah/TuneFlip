#!/usr/bin/env node
import { Command } from 'commander';
import { convertPaths } from './lib/convert.js';
import { resolve, dirname } from 'node:path';
import fs from 'node:fs';
import chalk from 'chalk';
import { fileURLToPath } from 'node:url';

function readPkg() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = resolve(__dirname, '../package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    return { version: pkg.version || '0.0.0', description: pkg.description || '' };
  } catch {
    return { version: '0.0.0', description: '' };
  }
}

const { version, description } = readPkg();

const program = new Command();

type CLIOptions = {
  out: string;
  bitrate?: number;
  vbr?: number;
  samplerate?: number;
  channels?: number;
  loudnorm?: boolean;
  trim?: string;
  concurrency?: number;
  keepStructure?: boolean;
  overwrite?: boolean;
  dryRun?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  date?: string;
  track?: string;
  comment?: string;
  cover?: string;
};

program
  .name('vid2mp3')
  .description(description)
  .version(version)
  .argument('[inputs...]', 'Input file(s) or glob(s) (e.g., "videos/*.mp4")')
  .option('-o, --out <dir>', 'Output directory (will be created if missing)', 'out')
  .option('-b, --bitrate <kbps>', 'Target MP3 bitrate in kbps (e.g., 192)', parseInt)
  .option('--vbr <level>', 'MP3 VBR quality level 0(best)-9(worst). If set, ignores --bitrate', parseInt)
  .option('-r, --samplerate <hz>', 'Audio sample rate in Hz (e.g., 44100, 48000)', parseInt)
  .option('-c, --channels <n>', 'Number of audio channels (1 mono, 2 stereo)', parseInt)
  .option('--loudnorm', 'Apply EBU R128 loudness normalization (two-pass)')
  .option('--trim <range>', 'Trim audio: start-end in seconds (e.g., 5-65) or start only (e.g., 5)')
  .option('-C, --concurrency <n>', 'Max concurrent conversions', (v: string)=>parseInt(v))
  .option('--keep-structure', 'Preserve relative folder structure under output dir for glob inputs')
  .option('--overwrite', 'Overwrite existing outputs if present')
  .option('--dry-run', 'Show what would be done without writing files')
  .option('--title <s>', 'ID3 title tag')
  .option('--artist <s>', 'ID3 artist tag')
  .option('--album <s>', 'ID3 album tag')
  .option('--genre <s>', 'ID3 genre tag')
  .option('--date <s>', 'ID3 date/year tag')
  .option('--track <s>', 'ID3 track tag (e.g., 3/12)')
  .option('--comment <s>', 'ID3 comment')
  .option('--cover <path>', 'Embed image as album art')
  .action(async (inputs: string[], opts: CLIOptions) => {
    if (!inputs || inputs.length === 0) {
      console.log(chalk.yellow('No inputs provided. Use --help for examples.'));
      process.exit(1);
    }

    const outDir = resolve(process.cwd(), opts.out);
    if (!opts.dryRun) fs.mkdirSync(outDir, { recursive: true });

    try {
      const results = await convertPaths(inputs, {
        outDir,
        bitrateKbps: opts.bitrate,
        vbrLevel: opts.vbr,
        sampleRate: opts.samplerate,
        channels: opts.channels,
        loudnorm: !!opts.loudnorm,
        trim: opts.trim,
        concurrency: opts.concurrency,
        keepStructure: !!opts.keepStructure,
        overwrite: !!opts.overwrite,
        dryRun: !!opts.dryRun,
        metadata: {
          title: opts.title,
          artist: opts.artist,
          album: opts.album,
          genre: opts.genre,
          date: opts.date,
          track: opts.track,
          comment: opts.comment,
          coverImagePath: opts.cover,
        },
      });

  const ok = results.filter((r: { ok: boolean }) => r.ok).length;
      const fail = results.length - ok;
      console.log('\n' + chalk.green(`Done: ${ok} succeeded`) + (fail ? ' ' + chalk.red(`${fail} failed`) : ''));

      if (fail) {
        for (const r of results) {
          if (!r.ok) console.error(chalk.red(`✖ ${r.input} -> ${r.output || ''}: ${r.error}`));
        }
        process.exitCode = 1;
      }
    } catch (err: any) {
      console.error(chalk.red(err?.message || String(err)));
      process.exit(1);
    }
  });

program.parseAsync();
