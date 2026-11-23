import * as Fs from 'node:fs';
import * as Path from 'node:path';

type GitResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type GitFile = {
  root: string;
  relativePath: string;
};

const runGit = (cwd: string, args: string[]): GitResult => {
  const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString().trim(),
  };
};

/**
 * Finds the git repository that contains `filePath` and the path of the file relative to its root.
 * Gives `null` when the file is not inside a git repository.
 */
export const findGitFile = (filePath: string): GitFile | null => {
  const absolutePath = Fs.realpathSync(filePath);
  const result = runGit(Path.dirname(absolutePath), ['rev-parse', '--show-toplevel']);
  if (!result.ok) {
    return null;
  }
  const root = Fs.realpathSync(result.stdout.trim());
  return { root, relativePath: Path.relative(root, absolutePath) };
};

/**
 * Resolves a git ref (branch, tag, `HEAD~1`, SHA) to a commit SHA.
 */
export const resolveCommit = (root: string, ref: string): string => {
  const result = runGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (!result.ok) {
    throw new Error(`Cannot resolve git ref "${ref}" to a commit`);
  }
  return result.stdout.trim();
};

/**
 * Reads the content of a file at a commit. Returns `null` if the file does not exist in that commit.
 */
export const readFileAtCommit = (root: string, commit: string, relativePath: string): string | null => {
  const result = runGit(root, ['show', `${commit}:${relativePath}`]);
  return result.ok ? result.stdout : null;
};

export type FileCommit = {
  commit: string;
  date: number;
  subject: string;
  /** True for the commit where the branch forked from the upstream. */
  forkPoint: boolean;
};

const FIELD_SEPARATOR = '\x1f';
const LOG_FORMAT = `--format=${['%H', '%at', '%s'].join(FIELD_SEPARATOR)}`;

const parseLog = (stdout: string, forkPoint: boolean): FileCommit[] =>
  stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [commit, date, subject] = line.split(FIELD_SEPARATOR);
      return { commit, date: Number(date), subject, forkPoint };
    });

/**
 * Lists the diff bases of the current branch, oldest first: the commit where `HEAD` forked from `upstream`,
 * then the commits since that changed the file. `date` is the author time in seconds.
 * Lists the whole history of the file when `upstream` does not exist.
 */
export const listBranchHistory = (root: string, relativePath: string, upstream = 'origin/HEAD'): FileCommit[] => {
  const mergeBase = runGit(root, ['merge-base', 'HEAD', upstream]);
  if (!mergeBase.ok) {
    const result = runGit(root, ['log', LOG_FORMAT, 'HEAD', '--', relativePath]);
    return result.ok ? parseLog(result.stdout, false).reverse() : [];
  }
  const forkCommit = mergeBase.stdout.trim();
  const fork = runGit(root, ['log', '--max-count=1', LOG_FORMAT, forkCommit]);
  const branch = runGit(root, ['log', LOG_FORMAT, `${forkCommit}..HEAD`, '--', relativePath]);
  return [...parseLog(fork.stdout, true), ...parseLog(branch.stdout, false).reverse()];
};

/**
 * Finds the last commit reachable from `ref` that changed the file. Returns `null` if no commit changed it.
 */
export const lastCommitTouching = (root: string, ref: string, relativePath: string): string | null => {
  const result = runGit(root, ['log', '--max-count=1', '--format=%H', ref, '--', relativePath]);
  const commit = result.stdout.trim();
  return result.ok && commit !== '' ? commit : null;
};

/**
 * Gives the author time of a commit in seconds. Returns `null` when the commit does not resolve.
 */
export const authorDate = (root: string, commit: string): number | null => {
  const result = runGit(root, ['log', '--max-count=1', '--format=%at', commit]);
  const date = Number(result.stdout.trim());
  return result.ok && Number.isFinite(date) && result.stdout.trim() !== '' ? date : null;
};
