import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as Fs from 'node:fs';
import * as Os from 'node:os';
import * as Path from 'node:path';
import { authorDate, lastCommitTouching, listBranchHistory, resolveCommit } from './git';

let root = '';

const git = (...args: string[]): string => {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
};

const commit = (file: string, content: string, message: string): string => {
  Fs.writeFileSync(Path.join(root, file), content);
  git('add', file);
  git('commit', '--quiet', '--message', message);
  return git('rev-parse', 'HEAD');
};

beforeAll(() => {
  root = Fs.realpathSync(Fs.mkdtempSync(Path.join(Os.tmpdir(), 'mdlive-git-')));
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
});

afterAll(() => {
  Fs.rmSync(root, { recursive: true, force: true });
});

describe('listBranchHistory', () => {
  test('starts at the fork point and lists the branch commits that changed the file', () => {
    const fork = commit('doc.md', 'one\n', 'on main');
    git('update-ref', 'refs/remotes/origin/main', fork);
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    git('checkout', '--quiet', '-b', 'feature');
    const first = commit('doc.md', 'two\n', 'first');
    commit('other.md', 'x\n', 'unrelated');
    const second = commit('doc.md', 'three\n', 'second');
    expect(listBranchHistory(root, 'doc.md').map((entry) => entry.commit)).toEqual([fork, first, second]);
  });

  test('marks the fork point', () => {
    expect(listBranchHistory(root, 'doc.md').map((entry) => entry.forkPoint)).toEqual([true, false, false]);
  });

  test('includes the commit subject', () => {
    expect(listBranchHistory(root, 'doc.md').at(-1)?.subject).toBe('second');
  });

  test('ignores commits made on the upstream after the fork', () => {
    const fork = resolveCommit(root, 'origin/HEAD');
    git('checkout', '--quiet', '-b', 'later-main', fork);
    const later = commit('doc.md', 'main moved\n', 'main moved');
    git('update-ref', 'refs/remotes/origin/main', later);
    git('checkout', '--quiet', 'feature');
    expect(listBranchHistory(root, 'doc.md')[0].commit).toBe(fork);
  });

  test('lists the whole history when the upstream does not exist', () => {
    expect(listBranchHistory(root, 'doc.md', 'origin/missing').map((entry) => entry.subject)).toEqual([
      'on main',
      'first',
      'second',
    ]);
  });

  test('returns an empty history for an untracked file', () => {
    expect(listBranchHistory(root, 'missing.md', 'origin/missing')).toEqual([]);
  });
});

describe('lastCommitTouching', () => {
  test('finds the last commit that changed the file at a ref', () => {
    expect(lastCommitTouching(root, 'HEAD', 'doc.md')).toBe(resolveCommit(root, 'HEAD'));
  });

  test('skips commits that did not change the file', () => {
    expect(lastCommitTouching(root, 'HEAD~1', 'doc.md')).toBe(resolveCommit(root, 'HEAD~2'));
  });

  test('returns null when no commit changed the file', () => {
    expect(lastCommitTouching(root, 'HEAD', 'missing.md')).toBeNull();
  });
});

describe('authorDate', () => {
  test('gives the author time of a commit in seconds', () => {
    const date = authorDate(root, 'HEAD');
    expect(date).toBe(Number(git('log', '--max-count=1', '--format=%at', 'HEAD')));
  });

  test('uses the author time, not the commit time', () => {
    expect(listBranchHistory(root, 'doc.md').at(-1)?.date).toBe(Number(git('log', '--max-count=1', '--format=%at', '--', 'doc.md')));
  });

  test('returns null for an unknown commit', () => {
    expect(authorDate(root, 'deadbeef')).toBeNull();
  });
});

