import { makeVertical } from '@hadialmarzooq/agent-media-ffmpeg';

const result = await makeVertical({
  input: 'demo.mp4',
  output: 'vertical.mp4',
  maxSizeMB: 25,
  onProgress: (progress) => console.error(JSON.stringify(progress)),
});

console.log(JSON.stringify(result, null, 2));
