const fs = require('node:fs');
const path = require('node:path');

// Use CommonJS approach for __dirname
const currentDir = __dirname;

// When running from dist/gui/copy-assets.js, __dirname is dist/gui
const destHtml = path.resolve(__dirname, 'index.html');
const destPreloadCjs = path.resolve(__dirname, 'preload.cjs');
const destCss = path.resolve(__dirname, 'app.css');

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src: string, dst: string) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

const srcRoot = path.resolve(__dirname, '../../src/gui');
copyFile(path.join(srcRoot, 'index.html'), destHtml);
// Copy stylesheet
const srcCss = path.join(srcRoot, 'app.css');
if (fs.existsSync(srcCss)) {
  copyFile(srcCss, destCss);
}
// Also copy CommonJS preload
const srcPreloadCjs = path.join(srcRoot, 'preload.cjs');
if (fs.existsSync(srcPreloadCjs)) {
  copyFile(srcPreloadCjs, destPreloadCjs);
}
