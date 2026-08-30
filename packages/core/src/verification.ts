import type { MediaExpectations } from './ir.js';
import type { MediaMetadata } from './media.js';

export interface VerificationCheck {
  passed: boolean;
  expected: unknown;
  actual: unknown;
  message: string;
}

export interface VerificationReport {
  passed: boolean;
  checks: Record<string, VerificationCheck>;
  failures: string[];
  warnings: string[];
}

/** A custom verification check: receives the inspected output, returns named checks. */
export type CustomVerificationCheck = (
  output: MediaMetadata,
) => Record<string, VerificationCheck> | null;

export interface VerifyOptions {
  /** Custom checks merged into the report after the plan's expectations. */
  customChecks?: CustomVerificationCheck[];
  /** Check names that warn instead of fail. A failing warn-only check never fails the report. */
  warnOnly?: string[];
}

/** Verify inspected output against the semantic expectations recorded in a plan. */
export function verifyMedia(
  output: MediaMetadata,
  expectations: MediaExpectations,
  options: VerifyOptions = {},
): VerificationReport {
  const checks: Record<string, VerificationCheck> = {};
  if (expectations.durationSeconds !== undefined) {
    const actual = output.durationSeconds;
    checks.duration = check(
      actual !== undefined && Math.abs(actual - expectations.durationSeconds) <= 0.25,
      `within 0.25s of ${expectations.durationSeconds}s`,
      actual,
      'Output duration does not match the planned range.',
    );
  }
  if (expectations.aspectRatio !== undefined) {
    checks.aspectRatio = check(
      matchesAspectRatio(output.video, expectations.aspectRatio),
      expectations.aspectRatio,
      output.video?.aspectRatio,
      'Output aspect ratio does not match the requested ratio.',
    );
  }
  if (expectations.width !== undefined) {
    checks.width = check(
      output.video?.width === expectations.width,
      expectations.width,
      output.video?.width,
      'Output width does not match the requested width.',
    );
  }
  if (expectations.height !== undefined) {
    checks.height = check(
      output.video?.height === expectations.height,
      expectations.height,
      output.video?.height,
      'Output height does not match the requested height.',
    );
  }
  if (expectations.maxSizeBytes !== undefined) {
    const limit = Math.floor(expectations.maxSizeBytes * 1.02);
    checks.maxFileSize = check(
      output.sizeBytes <= limit,
      `<= ${expectations.maxSizeBytes} bytes (2% tolerance)`,
      output.sizeBytes,
      'Output exceeds the requested maximum file size.',
    );
  }
  if (expectations.audio !== undefined) {
    const expected = expectations.audio === 'remove' ? false : true;
    checks.audio = check(
      output.audio.present === expected,
      expected ? 'audio present' : 'audio absent',
      output.audio.present ? 'audio present' : 'audio absent',
      'Output audio presence does not match the plan.',
    );
  }
  if (expectations.container !== undefined) {
    checks.container = check(
      output.container === expectations.container,
      expectations.container,
      output.container,
      'Output container does not match the requested container.',
    );
  }
  if (expectations.videoCodec !== undefined) {
    checks.videoCodec = check(
      output.video?.codec === expectations.videoCodec,
      expectations.videoCodec,
      output.video?.codec,
      'Output video codec does not match the requested compatibility profile.',
    );
  }
  if (expectations.pixelFormat !== undefined) {
    checks.pixelFormat = check(
      output.video?.pixelFormat === expectations.pixelFormat,
      expectations.pixelFormat,
      output.video?.pixelFormat,
      'Output pixel format does not match the requested compatibility profile.',
    );
  }
  // A custom check that throws is isolated: it is recorded as a failed check but always
  // downgraded to a warning, so a broken plugin cannot crash verification or fail an output
  // that satisfies its plan. It is never recorded as a pass — it did not run.
  const isolated = new Set<string>();
  const customChecks = options.customChecks ?? [];
  for (const [index, customCheck] of customChecks.entries()) {
    let custom: Record<string, VerificationCheck> | null = null;
    try {
      custom = customCheck(output);
    } catch (error) {
      const name = `customCheck-${index + 1}`;
      isolated.add(name);
      checks[name] = {
        passed: false,
        expected: 'custom check executes',
        actual: 'custom check threw',
        message: `A custom verification check threw and was skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    if (custom === null) continue;
    for (const [name, result] of Object.entries(custom)) {
      checks[name] = result;
    }
  }

  const warnOnly = new Set(options.warnOnly ?? []);
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const [name, result] of Object.entries(checks)) {
    if (result.passed) continue;
    if (warnOnly.has(name) || isolated.has(name)) warnings.push(`${name}: ${result.message}`);
    else failures.push(`${name}: ${result.message}`);
  }
  const hasChecks = Object.keys(checks).some((name) => !isolated.has(name));
  if (!hasChecks) {
    failures.push('unverifiable: The plan recorded no expectations to verify against.');
  }
  return { passed: failures.length === 0 && hasChecks, checks, failures, warnings };
}

/**
 * Compare the output's real geometry against the requested ratio numerically, within a tolerance.
 *
 * Exact equality cannot be met in general: cropping 1920x1080 to 9:16 wants a 607.5px width, and
 * encoders need even dimensions, so the honest result is 606x1080 — visually 9:16, arithmetically
 * 101:180. Demanding an exact reduced fraction fails correct output. The tolerance is tight enough
 * that a genuinely wrong ratio (4:3 against 16:9) still fails.
 */
const ASPECT_RATIO_TOLERANCE = 0.01;

function matchesAspectRatio(video: MediaMetadata['video'], expected: string): boolean {
  if (video === undefined) return false;
  if (video.aspectRatio === expected) return true;
  const [expectedWidth, expectedHeight] = expected.split(':').map(Number);
  if (
    expectedWidth === undefined ||
    expectedHeight === undefined ||
    !Number.isFinite(expectedWidth) ||
    !Number.isFinite(expectedHeight) ||
    expectedHeight === 0 ||
    video.height === 0
  ) {
    return false;
  }
  const target = expectedWidth / expectedHeight;
  const actual = video.width / video.height;
  return Math.abs(actual - target) / target <= ASPECT_RATIO_TOLERANCE;
}

function check(
  passed: boolean,
  expected: unknown,
  actual: unknown,
  message: string,
): VerificationCheck {
  return { passed, expected, actual, message: passed ? 'Constraint satisfied.' : message };
}
