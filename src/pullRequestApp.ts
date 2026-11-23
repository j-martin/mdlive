import type { RunningApp, Snapshot } from './app';
import { renderMarkdownDiff } from './render';
import * as Review from './review';
import { createReviewHandlers } from './reviewHandlers';
import { startServer } from './server';
import { normalizeSource } from './sourcePosition';

export type PullRequestConfig = {
  /** Link to the pull request on GitHub. */
  url: string;
  /** File of the pull request to show, or `null` to pick one. */
  file: string | null;
  port: number;
};

type Versions = {
  pullRequest: Review.PullRequest;
  /** Commit where the pull request branched from its base. */
  base: string;
  /** Author time of the base commit, in seconds. */
  baseDate: number;
  baseContent: string | null;
  headContent: string;
};

const notAvailable = (): never => {
  throw new Error('Only the Review mode is available for a pull request opened by its link.');
};

/**
 * Shows a Markdown file of a pull request from its GitHub link, without a local checkout. The page compares the head
 * of the pull request with the commit it branched from, like GitHub, and Review is the only mode.
 * Throws when the link, the pull request or the file cannot be found.
 */
export const startPullRequestApp = async (config: PullRequestConfig): Promise<RunningApp> => {
  const location = Review.parsePullRequestUrl(config.url);
  if (location === null) {
    throw new Error(`"${config.url}" is not a GitHub pull request link`);
  }
  const cwd = process.cwd();
  const findPullRequest = () => Review.findPullRequest(cwd, config.url);
  const { path, others } = Review.pickPullRequestFile(await Review.pullRequestFiles(cwd, config.url), config.file, location.anchor);
  if (others.length > 0) {
    console.log(`mdlive: the pull request also changes ${others.join(', ')}; choose one with --file <path>`);
  }

  const loadVersions = async (pullRequest: Review.PullRequest): Promise<Versions> => {
    const { commit: base, date: baseDate } = await Review.mergeBase(cwd, location, pullRequest);
    const [baseContent, headContent] = await Promise.all([
      Review.fileAtCommit(cwd, location, path, base),
      Review.fileAtCommit(cwd, location, path, pullRequest.headRefOid),
    ]);
    if (headContent === null) {
      throw new Error(`${path} is not in the head of the pull request (${pullRequest.headRefOid.slice(0, 8)}).`);
    }
    return { pullRequest, base, baseDate, baseContent, headContent };
  };

  const initial = await findPullRequest();
  if (initial === null) {
    throw new Error(`${config.url} is not an open pull request`);
  }
  let versions = await loadVersions(initial);

  const build = (): Snapshot => {
    const result = renderMarkdownDiff(versions.baseContent, versions.headContent);
    return {
      base: versions.pullRequest.baseRefName,
      baseCommit: versions.base,
      baseDate: versions.baseDate,
      baseMissing: versions.baseContent === null,
      history: [],
      pinnedCommit: null,
      historyCommit: null,
      canOpen: false,
      canPrompt: false,
      canReview: true,
      inGit: true,
      canEdit: false,
      reviewOnly: true,
      reviewHead: { branch: versions.pullRequest.headRefName, commit: versions.pullRequest.headRefOid },
      source: normalizeSource(versions.headContent),
      html: result.html,
      stats: result.stats,
      error: null,
    };
  };

  let snapshot = build();
  const fileLabel = `PR #${initial.number} · ${path}`;
  const server = startServer(config.port, fileLabel, {
    current: () => snapshot,
    selectBase: notAvailable,
    openSource: async () => notAvailable(),
    patchSource: notAvailable,
    renderSource: notAvailable,
    promptClaude: async () => notAvailable(),
    ...createReviewHandlers({
      cwd,
      path,
      findPullRequest,
      renderedSource: () => versions.headContent,
      headContent: () => versions.headContent,
      showHead: async (pullRequest) => {
        if (pullRequest.headRefOid !== versions.pullRequest.headRefOid) {
          versions = await loadVersions(pullRequest);
          snapshot = build();
          server.send(snapshot);
        }
      },
      showsHead: () => true,
      shownHead: () => versions.pullRequest.headRefOid,
    }),
    stopReview: () => {},
  });

  console.log(`mdlive: ${fileLabel} (${versions.pullRequest.headRefOid.slice(0, 8)} vs ${versions.base.slice(0, 8)})`);
  console.log(`mdlive: ${server.url}`);
  return { url: server.url, fileLabel };
};
