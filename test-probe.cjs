const ffmpeg = require('fluent-ffmpeg');
const ffprobePath = require('ffprobe-static');
const path = require('path');

// Set ffprobe path
ffmpeg.setFfprobePath(ffprobePath.path);

// Probe the output file
ffmpeg.ffprobe(path.resolve('output/Clair Obscur_ Expedition 33 -  Une vie à peindre (Original Soundtrack).mp3'), (err, data) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Format info:');
    console.log(JSON.stringify(data.format, null, 2));
    console.log('\nStreams info:');
    console.log(JSON.stringify(data.streams, null, 2));
    
    // Check for attached pictures
    let hasAttachedPic = false;
    if (data.streams) {
      for (const stream of data.streams) {
        if (stream.disposition && stream.disposition.attached_pic) {
          console.log('\nFound attached picture stream:');
          console.log(JSON.stringify(stream, null, 2));
          hasAttachedPic = true;
        }
      }
    }
    
    if (!hasAttachedPic) {
      console.log('\nNo attached picture found in streams');
    }
  }
});