import { homedir } from 'node:os';
import path from 'node:path';

export type MediaBackend = 'git' | 'r2';

export interface AudioReport {
  status: 'none' | 'verified' | 'pending' | 'unverified';
  reason?: string;
  check?: string;
  retry?: string;
  fix?: string;
}

export interface PublishOutput {
  slug?: string;
  path?: string;
  audio: AudioReport;
}

export interface WebsiteMediaSetup {
  backend: MediaBackend;
  env: NodeJS.ProcessEnv;
  lockFile: string;
}

export const LOCK_WAIT_SEC = 3600;
export const LOCK_TIMEOUT_EXIT = 75;
export const GIT_DEPLOY_WAIT_SEC = 300;
export const R2_CREDENTIAL_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;
const AUDIO_STATUSES = new Set<AudioReport['status']>(['none', 'verified', 'pending', 'unverified']);
const REPORT_FIELDS = ['check', 'reason', 'retry', 'fix'] as const;

function homeOf(env: NodeJS.ProcessEnv): string {
  return env.HOME ?? homedir();
}

function withoutR2Credentials(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  for (const name of R2_CREDENTIAL_VARS) delete copy[name];
  return copy;
}

export function websiteMediaSetup(websiteRepo: string, env: NodeJS.ProcessEnv = process.env): WebsiteMediaSetup {
  const backend = env.MEDIA_BACKEND ?? 'git';
  const lockFile = path.join(websiteRepo, '.digest-runs', 'run.lock');
  const base = { ...withoutR2Credentials(env), MEDIA_BACKEND: backend, WEBSITE_DIR: websiteRepo };
  if (backend === 'git') {
    const mediaDir = env.WEBSITE_MEDIA_DIR ?? path.join(homeOf(env), 'website-worktrees', 'media');
    return {
      backend,
      lockFile,
      env: { ...base, WEBSITE_MEDIA_DIR: mediaDir, WEBSITE_MEDIA_ROOT: path.join(mediaDir, 'public', 'media') },
    };
  }
  if (backend === 'r2') return { backend, lockFile, env: base };
  throw new Error(`MEDIA_BACKEND must be git or r2, found: ${backend}`);
}

export function attachEnv(setup: WebsiteMediaSetup, pushed: boolean): NodeJS.ProcessEnv {
  return {
    ...setup.env,
    DIGEST_PUSH: pushed ? '1' : '0',
    ...(setup.backend === 'git' ? { MEDIA_DEPLOY_WAIT_SEC: String(GIT_DEPLOY_WAIT_SEC) } : {}),
  };
}

export function shouldAttach(setup: WebsiteMediaSetup, pushed: boolean, audio: AudioReport): boolean {
  return audio.status === 'pending' && (setup.backend === 'r2' || pushed);
}

export function lockedCommand(setup: WebsiteMediaSetup, command: string[]): string[] {
  return ['-o', '-E', String(LOCK_TIMEOUT_EXIT), '-w', String(LOCK_WAIT_SEC), setup.lockFile, ...command];
}

export function lockTimeoutMessage(setup: WebsiteMediaSetup): string {
  return `another digest run held ${setup.lockFile} for ${LOCK_WAIT_SEC}s`;
}

export function parsePublishOutput(stdout: string): PublishOutput {
  const line = stdout.trim().split('\n').pop() ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new Error(`publish-digest did not print a JSON result line: ${line.slice(0, 200)}`, { cause: err });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`publish-digest result is not an object: ${line.slice(0, 200)}`);
  }
  const { slug, path: entryPath, audio } = parsed as Record<string, unknown>;
  const status = (audio as Record<string, unknown> | undefined)?.status;
  if (!AUDIO_STATUSES.has(status as AudioReport['status'])) {
    throw new Error(`publish-digest result has no audio status: ${line.slice(0, 200)}`);
  }
  return {
    slug: typeof slug === 'string' ? slug : undefined,
    path: typeof entryPath === 'string' ? entryPath : undefined,
    audio: audio as AudioReport,
  };
}

type PendingFields = Partial<Pick<AudioReport, (typeof REPORT_FIELDS)[number]>>;

function pendingBlock(output: string, slug: string): string[] | undefined {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`[audio] PENDING ${slug}:`));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => !line.startsWith(' '));
  return end === -1 ? rest : rest.slice(0, end);
}

export function pendingReport(output: string, slug: string): PendingFields | undefined {
  const block = pendingBlock(output, slug);
  if (!block) return undefined;
  const fields: Record<string, string> = {};
  let current: string | undefined;
  for (const line of block) {
    const match = /^ {2}([a-z]+):\s*(.*)$/.exec(line);
    if (match) {
      current = (REPORT_FIELDS as readonly string[]).includes(match[1]) ? match[1] : undefined;
      if (current) fields[current] = match[2].trim();
    } else if (current && /^ {3,}\S/.test(line)) {
      fields[current] = `${fields[current]} ${line.trim()}`;
    } else {
      current = undefined;
    }
  }
  return fields;
}

function lastLine(output: string): string {
  return output.trim().split('\n').filter((line) => line.trim()).pop()?.trim() ?? '';
}

export function attachOutcome(
  code: number,
  output: string,
  slug: string,
  pending: AudioReport,
  setup: WebsiteMediaSetup
): AudioReport {
  if (code === 0) return { status: 'verified' };
  if (code === LOCK_TIMEOUT_EXIT) {
    return { ...pending, reason: `${lockTimeoutMessage(setup)}, so the audio is not attached yet` };
  }
  const report = pendingReport(output, slug);
  if (report) {
    const { retry, fix, ...rest } = { ...pending, ...report };
    return fix ? { ...rest, fix } : { ...rest, ...(retry ? { retry } : {}) };
  }
  const said = lastLine(output);
  return {
    ...pending,
    reason: `run.sh attach-pending exited ${code}${said ? `: ${said}` : ''}; logs are in ${path.dirname(setup.lockFile)}`,
  };
}
