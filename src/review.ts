import { normalizeSource, positionAt } from './sourcePosition';
import { runTool } from './tool';

export type PullRequest = {
  /** GraphQL node id. */
  id: string;
  number: number;
  title: string;
  url: string;
  /** Commit at the head of the pull request. Review comments are on this version of the file. */
  headRefOid: string;
  /** Branch of the pull request on its repository. */
  headRefName: string;
  /** Branch that the pull request merges into. */
  baseRefName: string;
};

export type PullRequestUrl = {
  owner: string;
  repo: string;
  number: number;
  /** SHA-256 of a file path, from a `#diff-...` anchor of the files page, or `null`. */
  anchor: string | null;
};

const MARKDOWN_FILE = /\.(md|markdown|mdx)$/i;

export type ReviewComment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  /** True for a comment of the viewer's pending review, which only the viewer sees until the review is published. */
  pending: boolean;
  /** True when the viewer can change the comment: their drafts and their published comments. */
  canEdit: boolean;
};

export type ReviewThread = {
  id: string;
  /** Last line of the thread in the file, or `null` for a comment on the whole file. */
  line: number | null;
  startLine: number | null;
  outdated: boolean;
  resolved: boolean;
  comments: ReviewComment[];
};

export type Review = {
  threads: ReviewThread[];
  /** The viewer's pending review, which holds the drafts until it is published. */
  pendingReviewId: string | null;
  draftCount: number;
};

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

type GraphQlComment = {
  id: string;
  body: string;
  author: { login: string } | null;
  createdAt: string;
  state: string;
  viewerCanUpdate?: boolean;
};

type GraphQlThread = {
  id: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  isOutdated: boolean;
  isResolved: boolean;
  subjectType: string;
  comments: { nodes: GraphQlComment[] };
};

type GraphQlPullRequest = {
  reviewThreads: { nodes: GraphQlThread[] };
  reviews: { nodes: { id: string; viewerDidAuthor: boolean }[] };
};

const REVIEW_QUERY = `query($id: ID!) { node(id: $id) { ... on PullRequest {
  reviewThreads(first: 100) { nodes { id path line originalLine startLine isOutdated isResolved subjectType
    comments(first: 100) { nodes { id body author { login } createdAt state viewerCanUpdate } } } }
  reviews(states: PENDING, first: 20) { nodes { id viewerDidAuthor } }
} } }`;

/**
 * Keeps the review threads of the file at `path` (relative to the repository root) and finds the viewer's
 * pending review. An outdated thread uses its original line.
 */
export const parseReview = (pullRequest: GraphQlPullRequest, path: string): Review => {
  const threads = pullRequest.reviewThreads.nodes
    .filter((thread) => thread.path === path)
    .map((thread) => ({
      id: thread.id,
      line: thread.subjectType === 'FILE' ? null : (thread.line ?? thread.originalLine),
      startLine: thread.startLine,
      outdated: thread.isOutdated,
      resolved: thread.isResolved,
      comments: thread.comments.nodes.map((comment) => ({
        id: comment.id,
        author: comment.author?.login ?? 'ghost',
        body: comment.body,
        createdAt: comment.createdAt,
        pending: comment.state === 'PENDING',
        canEdit: comment.viewerCanUpdate === true,
      })),
    }));
  return {
    threads,
    pendingReviewId: pullRequest.reviews.nodes.find((review) => review.viewerDidAuthor)?.id ?? null,
    draftCount: threads.reduce((count, thread) => count + thread.comments.filter((comment) => comment.pending).length, 0),
  };
};

/**
 * Gives the lines of the selection `from`-`to` of the local file in the head version of the pull request.
 * When the files differ, the selected text is found in the head version, and it must be there exactly once.
 * Returns `null` when the lines cannot be found, so that the comment goes on the whole file instead.
 */
export const headLines = (
  localMarkdown: string,
  headMarkdown: string | null,
  from: number,
  to: number,
): { startLine: number; endLine: number } | null => {
  if (headMarkdown === null) {
    return null;
  }
  const local = normalizeSource(localMarkdown);
  const head = normalizeSource(headMarkdown);
  const selected = local.slice(from, to);
  const leading = selected.length - selected.trimStart().length;
  const text = selected.trim();
  let start = from + leading;
  if (local !== head) {
    start = head.indexOf(text);
    if (text === '' || start === -1 || head.indexOf(text, start + 1) !== -1) {
      return null;
    }
  }
  return {
    startLine: positionAt(head, start).line + 1,
    endLine: positionAt(head, start + Math.max(text.length - 1, 0)).line + 1,
  };
};

/**
 * Builds the body of a review comment: the quoted selection, then the feedback.
 */
export const reviewBody = (quote: string, feedback: string): string => {
  const quoted = quote
    .trim()
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
  return `${quoted}\n\n${feedback.trim()}`;
};

const graphql = async <T>(root: string, query: string, variables: Record<string, string | number>): Promise<T> => {
  const flags = Object.entries(variables).flatMap(([name, value]) =>
    typeof value === 'number' ? ['-F', `${name}=${value}`] : ['-f', `${name}=${value}`],
  );
  const { data, errors } = JSON.parse(await runTool('gh', ['api', 'graphql', '-f', `query=${query}`, ...flags], root)) as {
    data: T;
    errors?: { message: string }[];
  };
  if (errors?.length) {
    throw new Error(errors.map((error) => error.message).join('; '));
  }
  return data;
};

/**
 * Reads a GitHub pull request link: `https://github.com/<owner>/<repo>/pull/<number>`, with an optional page
 * and `#diff-<sha256 of the path>` anchor. Returns `null` for anything else.
 */
export const parsePullRequestUrl = (text: string): PullRequestUrl | null => {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/[^#]*)?(?:#diff-([0-9a-f]+))?$/.exec(text);
  return match ? { owner: match[1], repo: match[2], number: Number(match[3]), anchor: match[4] ?? null } : null;
};

/**
 * Picks the file of a pull request to show: the `file` option, else the file of the diff anchor, else the first
 * Markdown file. `others` lists the other Markdown files when none of them was asked for.
 */
export const pickPullRequestFile = (files: string[], file: string | null, anchor: string | null): { path: string; others: string[] } => {
  if (file !== null) {
    if (!files.includes(file)) {
      throw new Error(`The pull request does not change ${file}. It changes: ${files.join(', ')}`);
    }
    return { path: file, others: [] };
  }
  const anchored = anchor === null ? undefined : files.find((path) => new Bun.CryptoHasher('sha256').update(path).digest('hex').startsWith(anchor));
  if (anchored !== undefined) {
    return { path: anchored, others: [] };
  }
  const markdown = files.filter((path) => MARKDOWN_FILE.test(path));
  if (markdown.length === 0) {
    throw new Error('The pull request changes no Markdown file.');
  }
  return { path: markdown[0], others: markdown.slice(1) };
};

/**
 * Finds an open pull request: the one of `target` (a link or a number) when given, else the one of the branch
 * checked out in `root`. Returns `null` when there is none.
 */
export const findPullRequest = async (root: string, target?: string): Promise<PullRequest | null> => {
  try {
    const fields = 'id,number,title,url,headRefOid,headRefName,baseRefName,state';
    const output = await runTool('gh', ['pr', 'view', ...(target === undefined ? [] : [target]), '--json', fields], root);
    const pullRequest = JSON.parse(output) as PullRequest & { state: string };
    return pullRequest.state === 'OPEN' ? pullRequest : null;
  } catch (error) {
    if (String(error).includes('no pull requests found')) {
      return null;
    }
    throw error;
  }
};

/**
 * Lists the paths of the files that the pull request changes.
 */
export const pullRequestFiles = async (root: string, target: string): Promise<string[]> => {
  const output = await runTool('gh', ['pr', 'view', target, '--json', 'files', '--jq', '.files[].path'], root);
  return output.split('\n').filter((path) => path !== '');
};

/**
 * Reads a file of a GitHub repository at a commit. Returns `null` when the file does not exist there.
 */
export const fileAtCommit = async (root: string, location: PullRequestUrl, path: string, commit: string): Promise<string | null> => {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  try {
    return await runTool(
      'gh',
      ['api', '-H', 'Accept: application/vnd.github.raw+json', `repos/${location.owner}/${location.repo}/contents/${encoded}?ref=${commit}`],
      root,
    );
  } catch (error) {
    if (String(error).includes('404')) {
      return null;
    }
    throw error;
  }
};

/**
 * Gives the commit where the pull request branched from its base, which GitHub compares the head with, and its
 * author time in seconds.
 */
export const mergeBase = async (root: string, location: PullRequestUrl, pullRequest: PullRequest): Promise<{ commit: string; date: number }> => {
  const output = await runTool(
    'gh',
    [
      'api',
      `repos/${location.owner}/${location.repo}/compare/${pullRequest.baseRefName}...${pullRequest.headRefOid}`,
      '--jq',
      '[.merge_base_commit.sha, .merge_base_commit.commit.author.date] | @tsv',
    ],
    root,
  );
  const [commit, date] = output.trim().split('\t');
  return { commit, date: Math.floor(Date.parse(date) / 1000) };
};

/**
 * Builds what the page receives about the review: the pull request and the threads and drafts of the file.
 */
export const reviewPayload = (pullRequest: PullRequest | null, review: Review | null) => ({
  pullRequest: pullRequest && { number: pullRequest.number, title: pullRequest.title, url: pullRequest.url },
  threads: review?.threads ?? [],
  draftCount: review?.draftCount ?? 0,
});

/**
 * Fetches the head of the pull request from `origin`, so that its commit can be read locally. GitHub keeps the head
 * of every pull request at `pull/<number>/head`, which also covers pull requests from forks.
 */
export const fetchPullRequestHead = async (root: string, pullRequest: PullRequest): Promise<void> => {
  await runTool('git', ['fetch', '--quiet', 'origin', `pull/${pullRequest.number}/head`], root);
};

/**
 * Loads the review threads of the file at `path` and the viewer's pending review.
 */
export const loadReview = async (root: string, pullRequest: PullRequest, path: string): Promise<Review> => {
  const data = await graphql<{ node: GraphQlPullRequest }>(root, REVIEW_QUERY, { id: pullRequest.id });
  return parseReview(data.node, path);
};

const createPendingReview = async (root: string, pullRequest: PullRequest): Promise<string> => {
  const data = await graphql<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(
    root,
    `mutation($pr: ID!, $commit: GitObjectID!) {
      addPullRequestReview(input: { pullRequestId: $pr, commitOID: $commit }) { pullRequestReview { id } } }`,
    { pr: pullRequest.id, commit: pullRequest.headRefOid },
  );
  return data.addPullRequestReview.pullRequestReview.id;
};

const addThread = async (
  root: string,
  reviewId: string,
  path: string,
  body: string,
  lines: { startLine: number; endLine: number } | null,
): Promise<void> => {
  if (lines === null) {
    await graphql(
      root,
      `mutation($review: ID!, $path: String!, $body: String!) {
        addPullRequestReviewThread(input: { pullRequestReviewId: $review, path: $path, body: $body, subjectType: FILE }) { thread { id } } }`,
      { review: reviewId, path, body },
    );
    return;
  }
  const multiline = lines.startLine < lines.endLine;
  await graphql(
    root,
    `mutation($review: ID!, $path: String!, $body: String!, $line: Int!${multiline ? ', $start: Int!' : ''}) {
      addPullRequestReviewThread(input: { pullRequestReviewId: $review, path: $path, body: $body, line: $line, side: RIGHT${
        multiline ? ', startLine: $start, startSide: RIGHT' : ''
      } }) { thread { id } } }`,
    { review: reviewId, path, body, line: lines.endLine, ...(multiline ? { start: lines.startLine } : {}) },
  );
};

/**
 * Adds a draft review comment: a thread in the viewer's pending review, which is created when missing.
 * A comment on lines outside the changes of the pull request is refused by GitHub, so it goes on the whole file.
 * Returns where the comment went.
 */
export const addDraftComment = async (
  root: string,
  pullRequest: PullRequest,
  pendingReviewId: string | null,
  path: string,
  body: string,
  lines: { startLine: number; endLine: number } | null,
): Promise<'line' | 'file'> => {
  const reviewId = pendingReviewId ?? (await createPendingReview(root, pullRequest));
  if (lines !== null) {
    try {
      await addThread(root, reviewId, path, body, lines);
      return 'line';
    } catch (error) {
      console.warn(`mdlive: commenting on lines ${lines.startLine}-${lines.endLine} failed, commenting on the file: ${String(error)}`);
    }
  }
  await addThread(root, reviewId, path, body, null);
  return 'file';
};

/**
 * Deletes a draft review comment.
 */
export const deleteDraftComment = async (root: string, commentId: string): Promise<void> => {
  await graphql(root, `mutation($id: ID!) { deletePullRequestReviewComment(input: { id: $id }) { clientMutationId } }`, {
    id: commentId,
  });
};

/**
 * Changes the text of a review comment, a draft or a published one.
 */
export const updateComment = async (root: string, commentId: string, body: string): Promise<void> => {
  await graphql(
    root,
    `mutation($id: ID!, $body: String!) {
      updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) { clientMutationId } }`,
    { id: commentId, body },
  );
};

/**
 * Deletes the pending review and all its drafts.
 */
export const discardReview = async (root: string, reviewId: string): Promise<void> => {
  await graphql(root, `mutation($id: ID!) { deletePullRequestReview(input: { pullRequestReviewId: $id }) { clientMutationId } }`, {
    id: reviewId,
  });
};

/**
 * Publishes the pending review with its drafts. Returns the URL of the published review.
 */
export const submitReview = async (root: string, reviewId: string, event: ReviewEvent, body: string): Promise<string> => {
  const data = await graphql<{ submitPullRequestReview: { pullRequestReview: { url: string } } }>(
    root,
    `mutation($id: ID!, $event: PullRequestReviewEvent!, $body: String!) {
      submitPullRequestReview(input: { pullRequestReviewId: $id, event: $event, body: $body }) { pullRequestReview { url } } }`,
    { id: reviewId, event, body },
  );
  return data.submitPullRequestReview.pullRequestReview.url;
};
