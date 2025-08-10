# vid2mp3-pro

Premium-quality bulk video to MP3 converter CLI with advanced controls.

## Features
- Single or bulk convert via file paths and globs
- Quality controls: CBR bitrate or VBR (libmp3lame)
- Optional EBU R128 loudness normalization (two-pass)
- Sample rate, channels, and trimming
- Concurrency for fast batch jobs
- Keep input folder structure under output
- Dry run and safe overwrite behavior

## Quick start (Windows PowerShell)

1. Install dependencies

```powershell
npm install
```

2. Build

```powershell
npm run build
```

3. Run help

```powershell
node .\dist\index.js --help
```

4. Convert a folder of videos

```powershell
node .\dist\index.js "videos/**/*.{mp4,mkv,webm}" -o out --bitrate 192 --concurrency 4
```

5. Use VBR with loudness normalization

```powershell
node .\dist\index.js "videos/*.mp4" -o out --vbr 2 --loudnorm
```

6. Trim and keep folder structure

```powershell
node .\dist\index.js "media/**/*.mkv" -o out --trim 5-65 --keep-structure --overwrite
```

Notes:
- ffmpeg-static and ffprobe-static are bundled, no system install needed.
- Input formats supported by ffmpeg are accepted.

## Options
Run `--help` to see all options.

## License
MIT
