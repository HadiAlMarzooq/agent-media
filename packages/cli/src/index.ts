#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';
import {
  MediaError,
  parsePlan,
  planMedia,
  serializePlan,
  verifyMedia,
  inspectPlanIssues,
  repairPlan,
  parseReceipt,
  mediaPlanSchemaId,
} from '@hadialmarzooq/agent-media-core';
import {
  executePlan,
  getCapabilities,
  inspectMedia,
  makeVertical,
  optimizeForWeb,
  normalize,
  extractAudio,
  extractFrame,
  concatenate,
} from '@hadialmarzooq/agent-media-ffmpeg';
import type { MediaProgress } from '@hadialmarzooq/agent-media-ffmpeg';

const packageVersion = (createRequire(import.meta.url)('../package.json') as { version: string })
  .version;

export function createProgram(): Command {
  const program = new Command();
  program
    .name('agent-media')
    .description('Deterministic semantic media transformations.')
    .version(packageVersion);
  program
    .command('inspect <input>')
    .description('Inspect media metadata.')
    .action(async (input) => print(await inspectMedia(input)));
  program
    .command('capabilities')
    .description('Detect local FFmpeg capabilities.')
    .action(async () => print(await getCapabilities()));
  program
    .command('plan <input>')
    .description('Create a versioned semantic media plan.')
    .option('--trim-start <seconds>', 'trim start in seconds', Number)
    .option('--duration <seconds>', 'output duration in seconds', Number)
    .option('--aspect <ratio>', 'target aspect ratio, e.g. 9:16')
    .option('--width <pixels>', 'target width', Number)
    .option('--height <pixels>', 'target height', Number)
    .option('--max-size <mb>', 'maximum file size in MB', Number)
    .option('--compatibility <level>', 'high or balanced')
    .option('--quality <level>', 'high, balanced, or small')
    .option('--remove-audio', 'remove audio')
    .option('--out <path>', 'write the plan JSON to a file')
    .action(async (input, options) => {
      const plan = planMedia({
        source: await inspectMedia(input),
        goals: {
          trimStartSeconds: options.trimStart,
          durationSeconds: options.duration,
          aspectRatio: options.aspect,
          width: options.width,
          height: options.height,
          maxSizeMB: options.maxSize,
          compatibility: options.compatibility,
          quality: options.quality,
          ...(options.removeAudio ? { audio: 'remove' } : {}),
        },
        capabilities: await getCapabilities(),
      });
      const serialized = serializePlan(plan);
      if (options.out !== undefined) await writeFile(options.out, `${serialized}\n`, 'utf8');
      print(plan);
    });
  program
    .command('vertical <input>')
    .description('Create and verify a high-compatibility 9:16 video.')
    .requiredOption('--output <path>', 'output media path')
    .option('--width <pixels>', 'target width (requires --height)', Number)
    .option('--height <pixels>', 'target height (requires --width)', Number)
    .option('--trim-start <seconds>', 'trim start in seconds', Number)
    .option('--duration <seconds>', 'output duration in seconds', Number)
    .option('--max-size <mb>', 'maximum file size in MB', Number)
    .option('--remove-audio', 'remove audio')
    .option('--overwrite', 'allow output replacement')
    .option('--progress', 'write NDJSON progress events to stderr')
    .action(async (input, options) => {
      const onProgress = progressWriter(Boolean(options.progress));
      print(
        await makeVertical({
          input,
          output: options.output,
          width: options.width,
          height: options.height,
          trimStartSeconds: options.trimStart,
          durationSeconds: options.duration,
          maxSizeMB: options.maxSize,
          ...(options.removeAudio ? { audio: 'remove' } : {}),
          overwrite: options.overwrite,
          ...(onProgress === undefined ? {} : { onProgress }),
        }),
      );
    });
  program
    .command('optimize <input>')
    .description('Create and verify a web-optimized high-compatibility video.')
    .requiredOption('--output <path>', 'output media path')
    .option('--trim-start <seconds>', 'trim start in seconds', Number)
    .option('--duration <seconds>', 'output duration in seconds', Number)
    .option('--max-size <mb>', 'maximum file size in MB', Number)
    .option('--quality <level>', 'high, balanced, or small')
    .option('--remove-audio', 'remove audio')
    .option('--overwrite', 'allow output replacement')
    .option('--progress', 'write NDJSON progress events to stderr')
    .action(async (input, options) => {
      const onProgress = progressWriter(Boolean(options.progress));
      print(
        await optimizeForWeb({
          input,
          output: options.output,
          trimStartSeconds: options.trimStart,
          durationSeconds: options.duration,
          maxSizeMB: options.maxSize,
          ...(options.quality === undefined ? {} : { quality: options.quality }),
          ...(options.removeAudio ? { audio: 'remove' } : {}),
          overwrite: options.overwrite,
          ...(onProgress === undefined ? {} : { onProgress }),
        }),
      );
    });
  program
    .command('normalize <input>')
    .description('Create and verify a normalized high-compatibility copy.')
    .requiredOption('--output <path>', 'output media path')
    .option('--trim-start <seconds>', 'trim start in seconds', Number)
    .option('--duration <seconds>', 'output duration in seconds', Number)
    .option('--remove-audio', 'remove audio')
    .option('--overwrite', 'allow output replacement')
    .option('--progress', 'write NDJSON progress events to stderr')
    .action(async (input, options) => {
      const onProgress = progressWriter(Boolean(options.progress));
      print(
        await normalize({
          input,
          output: options.output,
          trimStartSeconds: options.trimStart,
          durationSeconds: options.duration,
          ...(options.removeAudio ? { audio: 'remove' } : {}),
          overwrite: options.overwrite,
          ...(onProgress === undefined ? {} : { onProgress }),
        }),
      );
    });
  program
    .command('extract-audio <input>')
    .description('Extract and verify audio from any media source.')
    .requiredOption('--output <path>', 'output audio path')
    .option('--format <format>', 'm4a, mp3, or wav')
    .option('--trim-start <seconds>', 'trim start in seconds', Number)
    .option('--duration <seconds>', 'output duration in seconds', Number)
    .option('--overwrite', 'allow output replacement')
    .option('--progress', 'write NDJSON progress events to stderr')
    .action(async (input, options) => {
      const onProgress = progressWriter(Boolean(options.progress));
      print(
        await extractAudio({
          input,
          output: options.output,
          ...(options.format === undefined ? {} : { format: options.format }),
          trimStartSeconds: options.trimStart,
          durationSeconds: options.duration,
          overwrite: options.overwrite,
          ...(onProgress === undefined ? {} : { onProgress }),
        }),
      );
    });
  program
    .command('extract-frame <input>')
    .description('Extract and verify a still frame from a video source.')
    .requiredOption('--output <path>', 'output frame path')
    .option('--at <seconds>', 'frame timestamp in seconds', Number)
    .option('--format <format>', 'jpg or png')
    .option('--overwrite', 'allow output replacement')
    .option('--progress', 'write NDJSON progress events to stderr')
    .action(async (input, options) => {
      const onProgress = progressWriter(Boolean(options.progress));
      print(
        await extractFrame({
          input,
          output: options.output,
          ...(options.at === undefined ? {} : { atSeconds: options.at }),
          ...(options.format === undefined ? {} : { format: options.format }),
          overwrite: options.overwrite,
          ...(onProgress === undefined ? {} : { onProgress }),
        }),
      );
    });
  program
    .command('concatenate <input>')
    .description('Concatenate multiple media sources into a single verified output.')
    .requiredOption('--inputs <paths...>', 'additional input paths to concatenate')
    .requiredOption('--output <path>', 'output media path')
    .option('--overwrite', 'allow output replacement')
    .option('--progress', 'write NDJSON progress events to stderr')
    .action(async (input, options) => {
      const onProgress = progressWriter(Boolean(options.progress));
      print(
        await concatenate({
          input,
          inputs: options.inputs,
          output: options.output,
          overwrite: options.overwrite,
          ...(onProgress === undefined ? {} : { onProgress }),
        }),
      );
    });
  program
    .command('validate-plan <plan>')
    .description('Detect mechanical plan issues against a real source without executing.')
    .action(async (planPath) => {
      const plan = parsePlan(await readFile(planPath, 'utf8'));
      const source = await inspectMedia(plan.source.path);
      print({ issues: inspectPlanIssues(plan, source) });
    });
  program
    .command('repair-plan <plan>')
    .description('Repair mechanical plan issues and write the repaired plan.')
    .requiredOption('--out <path>', 'write the repaired plan JSON to a file')
    .action(async (planPath, options) => {
      const plan = parsePlan(await readFile(planPath, 'utf8'));
      const source = await inspectMedia(plan.source.path);
      const { plan: repaired, repairs } = repairPlan(plan, source);
      await writeFile(options.out, `${serializePlan(repaired)}\n`, 'utf8');
      print({ repairs, repairedPlan: repaired });
    });
  program
    .command('receipt <path>')
    .description('Inspect a saved execution receipt.')
    .action(async (receiptPath) => {
      print(parseReceipt(await readFile(receiptPath, 'utf8')));
    });
  program
    .command('schema')
    .description('Print the canonical Media Plan JSON Schema.')
    .action(async () => {
      const { mediaPlanJsonSchema } = await import('@hadialmarzooq/agent-media-core');
      print({ $id: mediaPlanSchemaId, ...mediaPlanJsonSchema });
    });
  program
    .command('execute <plan>')
    .description('Execute a saved plan.')
    .requiredOption('--output <path>', 'output media path')
    .option('--overwrite', 'allow output replacement')
    .option('--progress', 'write NDJSON progress events to stderr')
    .option('--write-receipt', 'write a durable receipt to <output>.receipt.json')
    .option(
      '--resume',
      'skip execution when a passing receipt exists for the same plan and unchanged source',
    )
    .action(async (planPath, options) => {
      const plan = parsePlan(await readFile(planPath, 'utf8'));
      const onProgress = progressWriter(Boolean(options.progress));
      const result = await executePlan(plan, {
        output: options.output,
        overwrite: options.overwrite,
        ...(onProgress === undefined ? {} : { onProgress }),
        ...(options.writeReceipt === undefined ? {} : { writeReceipt: options.writeReceipt }),
        ...(options.resume === undefined ? {} : { resume: options.resume }),
      });
      print({
        output: result.output,
        ...(result.resumed === undefined ? {} : { resumed: result.resumed }),
        verification: verifyMedia(await inspectMedia(result.output), plan.expectations),
      });
    });
  program
    .command('verify <output>')
    .description('Verify an output against a saved plan.')
    .requiredOption('--against <plan>', 'plan JSON path')
    .action(async (outputPath, options) => {
      const plan = parsePlan(await readFile(options.against, 'utf8'));
      print(verifyMedia(await inspectMedia(outputPath), plan.expectations));
    });
  return program;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function progressWriter(enabled: boolean): ((progress: MediaProgress) => void) | undefined {
  if (!enabled) return undefined;
  return (progress) => {
    process.stderr.write(`${JSON.stringify({ type: 'progress', ...progress })}\n`);
  };
}

if (isMainModule()) {
  createProgram()
    .parseAsync()
    .catch((error: unknown) => {
      const output =
        error instanceof MediaError
          ? error.toJSON()
          : {
              code: 'UNEXPECTED_ERROR',
              message: error instanceof Error ? error.message : String(error),
            };
      process.stderr.write(`${JSON.stringify(output)}\n`);
      process.exitCode = 1;
    });
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
