import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GIT_DEPLOY_WAIT_SEC,
  LOCK_TIMEOUT_EXIT,
  attachEnv,
  attachOutcome,
  lockedCommand,
  parsePublishOutput,
  pendingReport,
  shouldAttach,
  websiteMediaSetup,
} from '@/src/lib/publish/website-media';

const REPO = path.join(tmpdir(), 'website-repo');
const HOME = path.join(tmpdir(), 'website-media-home');
const R2_CREDENTIALS = {
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'bucket',
};

function testEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MEDIA_BACKEND: undefined,
    WEBSITE_MEDIA_DIR: undefined,
    R2_ENV_FILE: undefined,
    HOME,
    ...overrides,
  };
}

describe('websiteMediaSetup', () => {
  it('defaults to the git backend and points publish-digest at the media worktree', () => {
    const setup = websiteMediaSetup(REPO, testEnv({}));
    expect(setup.backend).toBe('git');
    expect(setup.lockFile).toBe(path.join(REPO, '.digest-runs', 'run.lock'));
    expect(setup.env).toMatchObject({
      MEDIA_BACKEND: 'git',
      WEBSITE_DIR: REPO,
      WEBSITE_MEDIA_DIR: path.join(HOME, 'website-worktrees', 'media'),
      WEBSITE_MEDIA_ROOT: path.join(HOME, 'website-worktrees', 'media', 'public', 'media'),
    });
  });

  it('honours an explicit media worktree', () => {
    const mediaDir = path.join(HOME, 'elsewhere');
    const setup = websiteMediaSetup(REPO, testEnv({ WEBSITE_MEDIA_DIR: mediaDir }));
    expect(setup.env.WEBSITE_MEDIA_ROOT).toBe(path.join(mediaDir, 'public', 'media'));
  });

  it('never hands R2 credentials to publish-digest or run.sh, in either backend', () => {
    for (const backend of ['git', 'r2']) {
      const envFile = path.join(HOME, 'r2.env');
      const setup = websiteMediaSetup(REPO, testEnv({ MEDIA_BACKEND: backend, R2_ENV_FILE: envFile, ...R2_CREDENTIALS }));
      for (const name of Object.keys(R2_CREDENTIALS)) expect(setup.env).not.toHaveProperty(name);
      expect(setup.env.R2_ENV_FILE).toBe(envFile);
      expect(setup).not.toHaveProperty('nodeArgs');
    }
  });

  it('rejects an unknown backend', () => {
    expect(() => websiteMediaSetup(REPO, testEnv({ MEDIA_BACKEND: 's3' }))).toThrow(
      'MEDIA_BACKEND must be git or r2, found: s3'
    );
  });

  it('wraps commands in the run lock the cron uses', () => {
    const setup = websiteMediaSetup(REPO, testEnv({}));
    expect(lockedCommand(setup, ['node', 'x.mjs'])).toEqual([
      '-o',
      '-E',
      String(LOCK_TIMEOUT_EXIT),
      '-w',
      '3600',
      path.join(REPO, '.digest-runs', 'run.lock'),
      'node',
      'x.mjs',
    ]);
  });
});

describe('attach-pending after a publish', () => {
  const pending = { status: 'pending' as const, check: 'queued' };
  const git = websiteMediaSetup(REPO, testEnv({}));
  const r2 = websiteMediaSetup(REPO, testEnv({ MEDIA_BACKEND: 'r2' }));

  it('runs for r2 whether or not main was pushed, and for git only after a push', () => {
    expect(shouldAttach(r2, false, pending)).toBe(true);
    expect(shouldAttach(r2, true, pending)).toBe(true);
    expect(shouldAttach(git, true, pending)).toBe(true);
    expect(shouldAttach(git, false, pending)).toBe(false);
    expect(shouldAttach(r2, true, { status: 'none' })).toBe(false);
  });

  it('pushes only when main was pushed, and caps the git deploy wait', () => {
    expect(attachEnv(git, true)).toMatchObject({ DIGEST_PUSH: '1', MEDIA_DEPLOY_WAIT_SEC: String(GIT_DEPLOY_WAIT_SEC) });
    expect(attachEnv(r2, false).DIGEST_PUSH).toBe('0');
    expect(attachEnv(r2, true).MEDIA_DEPLOY_WAIT_SEC).toBeUndefined();
  });
});

describe('parsePublishOutput', () => {
  it('reads the last stdout line', () => {
    const out = parsePublishOutput(
      'noise\n{"slug":"manual-x","path":"src/content/digest/manual-x.md","audio":{"status":"pending","reason":"queued","check":"queued","retry":"run.sh attach-pending"}}\n'
    );
    expect(out).toEqual({
      slug: 'manual-x',
      path: 'src/content/digest/manual-x.md',
      audio: { status: 'pending', reason: 'queued', check: 'queued', retry: 'run.sh attach-pending' },
    });
  });

  it('fails loudly instead of guessing when the result line is missing or malformed', () => {
    expect(() => parsePublishOutput('')).toThrow('did not print a JSON result line');
    expect(() => parsePublishOutput('{"slug":"x"}')).toThrow('no audio status');
    expect(() => parsePublishOutput('{"slug":"x","audio":{"status":"maybe"}}')).toThrow('no audio status');
  });
});

describe('pendingReport', () => {
  it('reads only the block for this slug, joining continuation lines', () => {
    const output = [
      '[audio] PENDING manual-x: R2 already holds different audio under digests/manual-x.mp3, so this audio cannot be published there',
      '  url:    https://www.sjarmak.ai/media/digests/manual-x.mp3',
      '  check:  conflict',
      '  reason: R2 object digests/manual-x.mp3 already exists with different content',
      '  file:   /spool/digests/manual-x.mp3',
      '  published audio is unchanged: https://www.sjarmak.ai/media/digests/manual-x.mp3 still serves the earlier upload',
      '  fix:    give the issue a new slug and publish it again',
      '          or keep the published audio with cd /w && flock .digest-runs/run.lock node scripts/digest/audio-gate.mjs drop --slug manual-x',
      '[audio] PENDING other: the issue is published without a player until its audio verifies',
      '  reason: elsewhere',
    ].join('\n');
    expect(pendingReport(output, 'manual-x')).toEqual({
      check: 'conflict',
      reason: 'R2 object digests/manual-x.mp3 already exists with different content',
      fix:
        'give the issue a new slug and publish it again or keep the published audio with cd /w && flock .digest-runs/run.lock node scripts/digest/audio-gate.mjs drop --slug manual-x',
    });
    expect(pendingReport(output, 'missing')).toBeUndefined();
  });
});

describe('attachOutcome', () => {
  const pending = { status: 'pending' as const, reason: 'queued', check: 'queued', retry: 'retry-cmd' };
  const setup = websiteMediaSetup(REPO, testEnv({}));

  it('marks the audio verified when attach-pending exits 0', () => {
    expect(attachOutcome(0, '', 'manual-x', pending, setup)).toEqual({ status: 'verified' });
  });

  it('keeps it pending with the check, reason and retry run.sh printed for this slug', () => {
    const output = [
      '[audio] PENDING daily-2026-10-16: the issue is published without a player until its audio verifies',
      '  reason: another issue',
      '[audio] PENDING manual-x: the issue is published without a player until its audio verifies',
      '  url:    https://www.sjarmak.ai/media/digests/manual-x.mp3',
      '  check:  status',
      '  reason: HEAD returned 404',
      '  retry:  MEDIA_BACKEND=r2 DIGEST_PUSH=1 /w/scripts/digest/run.sh attach-pending',
    ].join('\n');
    expect(attachOutcome(1, output, 'manual-x', pending, setup)).toEqual({
      status: 'pending',
      check: 'status',
      reason: 'HEAD returned 404',
      retry: 'MEDIA_BACKEND=r2 DIGEST_PUSH=1 /w/scripts/digest/run.sh attach-pending',
    });
  });

  it('replaces the retry with the fix when run.sh says a retry cannot succeed', () => {
    const output = [
      '[audio] PENDING manual-x: R2 already holds different audio under digests/manual-x.mp3, so this audio cannot be published there',
      '  check:  conflict',
      '  reason: R2 object digests/manual-x.mp3 already exists with different content',
      '  fix:    give the issue a new slug and publish it again',
      '          or keep the published audio with drop-cmd',
    ].join('\n');
    expect(attachOutcome(1, output, 'manual-x', pending, setup)).toEqual({
      status: 'pending',
      check: 'conflict',
      reason: 'R2 object digests/manual-x.mp3 already exists with different content',
      fix: 'give the issue a new slug and publish it again or keep the published audio with drop-cmd',
    });
  });

  it('names the lock when another run held it', () => {
    const outcome = attachOutcome(LOCK_TIMEOUT_EXIT, '', 'manual-x', pending, setup);
    expect(outcome.status).toBe('pending');
    expect(outcome.reason).toContain('run.lock');
    expect(outcome.retry).toBe('retry-cmd');
  });

  it('quotes the last line run.sh printed when it reported nothing for this slug', () => {
    const output = 'starting\n[audio-gate] R2 credentials missing: R2_BUCKET. MEDIA_BACKEND=r2 reads only these variables\n';
    const outcome = attachOutcome(2, output, 'manual-x', pending, setup);
    expect(outcome.reason).toBe(
      `run.sh attach-pending exited 2: [audio-gate] R2 credentials missing: R2_BUCKET. MEDIA_BACKEND=r2 reads only these variables; logs are in ${path.join(REPO, '.digest-runs')}`
    );
    expect(outcome.retry).toBe('retry-cmd');
  });
});
