import { planMedia, verifyMedia } from '@hadialmarzooq/agent-media-core';
import { executePlan, inspectMedia } from '@hadialmarzooq/agent-media-ffmpeg';

const source = await inspectMedia('demo.mp4');
const plan = planMedia({
  source,
  goals: { aspectRatio: '9:16', compatibility: 'high', maxSizeMB: 25 },
});
const execution = await executePlan(plan, { output: 'vertical.mp4' });
const verification = verifyMedia(await inspectMedia(execution.output), plan.expectations);

console.log(JSON.stringify({ plan, execution, verification }, null, 2));
