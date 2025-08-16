// Simple test to demonstrate the conversion process
const fs = require('fs');
const path = require('path');

// Check if we have a valid video file
const testVideoPath = 'samples/demo.mp4';
console.log('Checking for test video file:', testVideoPath);

if (fs.existsSync(testVideoPath)) {
  const stats = fs.statSync(testVideoPath);
  console.log('File size:', stats.size, 'bytes');
  if (stats.size === 0) {
    console.log('ERROR: Test video file is empty (0 bytes)');
    console.log('This is why conversion fails - the file is corrupted or empty');
  } else {
    console.log('File appears to be valid');
  }
} else {
  console.log('ERROR: Test video file does not exist');
}

// Try to run the CLI version with a valid file (if we had one)
console.log('\nTo test conversion, you would run:');
console.log('node dist/index.js your-video.mp4 -o output --overwrite');