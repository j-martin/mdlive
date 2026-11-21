import { describe, expect, test } from 'bun:test';
import { headLines, parsePullRequestUrl, parseReview, pickPullRequestFile, reviewBody } from './review';

describe('headLines', () => {
  const local = '# Title\n\nFirst line.\nSecond line.\n';

  test('uses the local lines when the head has the same file', () => {
    expect(headLines(local, local, local.indexOf('Second'), local.indexOf('line.\n', 20) + 5)).toEqual({ startLine: 4, endLine: 4 });
  });

  test('gives the first and the last line of a selection on several lines', () => {
    expect(headLines(local, local, local.indexOf('First'), local.indexOf('Second') + 3)).toEqual({ startLine: 3, endLine: 4 });
  });

  test('finds the selected text in the head when the local file changed', () => {
    const head = '# Title\n\nIntro.\n\nFirst line.\nSecond line.\n';
    expect(headLines(local, head, local.indexOf('Second'), local.indexOf('Second') + 6)).toEqual({ startLine: 6, endLine: 6 });
  });

  test('returns null when the selected text is not in the head', () => {
    expect(headLines(local, '# Title\n', local.indexOf('Second'), local.indexOf('Second') + 6)).toBeNull();
  });

  test('returns null when the selected text appears twice in the head', () => {
    const head = 'Second line.\nSecond line.\n';
    expect(headLines(local + 'x', head, local.indexOf('Second'), local.indexOf('Second') + 6)).toBeNull();
  });

  test('returns null without a head version', () => {
    expect(headLines(local, null, 0, 3)).toBeNull();
  });
});

describe('reviewBody', () => {
  test('quotes the selection, then gives the feedback', () => {
    expect(reviewBody('First line.\nSecond **line**.', 'Too long.')).toBe('> First line.\n> Second **line**.\n\nToo long.');
  });
});

describe('parseReview', () => {
  const node = {
    reviewThreads: {
      nodes: [
        {
          id: 'T1',
          path: 'docs/a.md',
          line: 4,
          originalLine: 4,
          startLine: null,
          isOutdated: false,
          isResolved: false,
          subjectType: 'LINE',
          comments: { nodes: [{ id: 'C1', body: 'Hi', author: { login: 'ana' }, createdAt: '2026-11-20T10:00:00Z', state: 'PENDING', viewerCanUpdate: true }] },
        },
        {
          id: 'T2',
          path: 'other.md',
          line: 1,
          originalLine: 1,
          startLine: null,
          isOutdated: false,
          isResolved: false,
          subjectType: 'LINE',
          comments: { nodes: [] },
        },
        {
          id: 'T3',
          path: 'docs/a.md',
          line: null,
          originalLine: 9,
          startLine: null,
          isOutdated: true,
          isResolved: true,
          subjectType: 'LINE',
          comments: { nodes: [{ id: 'C3', body: 'Old', author: null, createdAt: '2026-11-19T10:00:00Z', state: 'SUBMITTED' }] },
        },
      ],
    },
    reviews: { nodes: [{ id: 'R1', viewerDidAuthor: true }] },
  };
  const review = parseReview(node, 'docs/a.md');

  test('keeps only the threads of the file', () => {
    expect(review.threads.map((thread) => thread.id)).toEqual(['T1', 'T3']);
  });

  test('uses the original line of an outdated thread', () => {
    expect(review.threads[1]).toMatchObject({ line: 9, outdated: true, resolved: true });
  });

  test('marks draft comments', () => {
    expect(review.threads[0].comments[0]).toMatchObject({ id: 'C1', author: 'ana', pending: true });
  });

  test('says which comments the viewer can edit', () => {
    expect(review.threads.map((thread) => thread.comments[0].canEdit)).toEqual([true, false]);
  });

  test('names a deleted author ghost', () => {
    expect(review.threads[1].comments[0].author).toBe('ghost');
  });

  test('gives the pending review of the viewer', () => {
    expect(review.pendingReviewId).toBe('R1');
  });

  test('counts the drafts', () => {
    expect(review.draftCount).toBe(1);
  });
});

describe('parsePullRequestUrl', () => {
  test('reads the owner, the repository and the number', () => {
    expect(parsePullRequestUrl('https://github.com/my-org/my-org-repo/pull/121')).toEqual({ owner: 'my-org', repo: 'my-org-repo', number: 121, anchor: null });
  });

  test('accepts the files page with a diff anchor', () => {
    expect(parsePullRequestUrl('https://github.com/o/r/pull/7/files#diff-603a27e7')).toEqual({ owner: 'o', repo: 'r', number: 7, anchor: '603a27e7' });
  });

  test('returns null for a file path', () => {
    expect(parsePullRequestUrl('docs/a.md')).toBeNull();
  });
});

describe('pickPullRequestFile', () => {
  const files = ['README.md', 'docs/a.md', 'src/x.ts'];

  test('uses the file option', () => {
    expect(pickPullRequestFile(files, 'docs/a.md', null)).toEqual({ path: 'docs/a.md', others: [] });
  });

  test('uses the file of the diff anchor', () => {
    const anchor = new Bun.CryptoHasher('sha256').update('docs/a.md').digest('hex');
    expect(pickPullRequestFile(files, null, anchor).path).toBe('docs/a.md');
  });

  test('uses the only Markdown file', () => {
    expect(pickPullRequestFile(['docs/a.md', 'src/x.ts'], null, null)).toEqual({ path: 'docs/a.md', others: [] });
  });

  test('uses the first Markdown file and names the others', () => {
    expect(pickPullRequestFile(files, null, null)).toEqual({ path: 'README.md', others: ['docs/a.md'] });
  });

  test('refuses a pull request without a Markdown file', () => {
    expect(() => pickPullRequestFile(['src/x.ts'], null, null)).toThrow('no Markdown file');
  });

  test('refuses a file option that is not in the pull request', () => {
    expect(() => pickPullRequestFile(files, 'missing.md', null)).toThrow('missing.md');
  });
});
