#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

import { Command } from 'commander';
import { MediaError, parsePlan, planMedia, serializePlan, verifyMedia } from '@agent-media/core';
import { executePlan, getCapabilities, inspectMedia } from '@agent-media/ffmpeg';

export function createProgram(): Command {
  const program = new Command();
  program
    .name('agent-media')
    .description('Deterministic semantic media transformations.')
    .version('0.0.6');
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
    .command('execute <plan>')
    .description('Execute a saved plan.')
    .requiredOption('--output <path>', 'output media path')
    .option('--overwrite', 'allow output replacement')
    .action(async (planPath, options) => {
      const plan = parsePlan(await readFile(planPath, 'utf8'));
      const result = await executePlan(plan, {
        output: options.output,
        sourceMetadata: await inspectMedia(plan.source.path),
        overwrite: options.overwrite,
      });
      print({
        ...result,
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

if (import.meta.url === `file://${process.argv[1]}`) {
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
