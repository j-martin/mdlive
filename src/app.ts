import * as Fs from 'node:fs';
import * as Path from 'node:path';
import { authorDate, commitFile, hasUncommittedChanges, lastCommitTouching, listBranchHistory, findGitFile, readFileAtCommit, resolveCommit, type FileCommit } from './git';
import { buildPrompt, hasHc, listPanes, pickClaudePane, pickHerdrSpace, sendToClaude, startClaude } from './claude';
import { applyPatches } from './edit';
import * as Review from './review';
import { createReviewHandlers } from './reviewHandlers';
import { findVault, openInObsidian } from './obsidian';
import { renderMarkdownDiff, type DiffStats } from './render';
import { locateClick, normalizeSource, positionAt } from './sourcePosition';
import { startServer } from './server';

const DEBOUNCE_MS = 80;
const BASE_POLL_INTERVAL_MS = 2_000;

export type AppConfig = {
  file: string;
  base: string;
  port: number;
};

export type RunningApp = {
  url: string;
  fileLabel: string;
};

export type Snapshot = {
  base: string;
  baseCommit: string;
  /** Author time of the base commit, in seconds, or `null` when unknown. */
  baseDate: number | null;
  baseMissing: boolean;
  /** The fork point from `origin/HEAD`, then the branch commits that changed the file, oldest first. */
  history: FileCommit[];
  /** The commit the user picked, or `null` when the diff follows the `--base` ref. */
  pinnedCommit: string | null;
  /** The commit in `history` whose version of the file is the diff base, or `null` if none. */
  historyCommit: string | null;
  /** False when the file is not in a git repository, so there is no diff, history or pull request. */
  inGit: boolean;
  /** True when a click on the page can open the file in Obsidian. */
  canOpen: boolean;
  /** True when a selection can be sent to a Claude Code pane with `hc`. */
  canPrompt: boolean;
  /** True when `gh` can review the pull request of the branch. */
  canReview: boolean;
  /** True when the page can edit the file, which needs a local file. */
  canEdit: boolean;
  /** True when the local file has changes that are not committed to git. */
  canCommit: boolean;
  /** True when Review is the only mode, for a pull request opened by its link. */
  reviewOnly: boolean;
  /** The version of the pull request head that the page shows in review mode, or `null` for the local file. */
  reviewHead: { branch: string; commit: string } | null;
  /** The rendered source with line endings normalized. The `data-src` ranges of the HTML index it. */
  source: string;
  html: string | null;
  stats: DiffStats | null;
  error: string | null;
};

/**
 * Starts the server, watches the Markdown file and polls the base ref so the page stays up to date.
 * Throws when the base ref does not resolve in a git repository. Outside a git repository, the page shows no diff.
 */
export const startApp = (config: AppConfig): RunningApp => {
  const filePath = Path.resolve(config.file);
  const located = findGitFile(filePath);
  const inGit = located !== null;
  const realPath = Fs.realpathSync(filePath);
  const gitFile = located ?? { root: Path.dirname(realPath), relativePath: Path.basename(realPath) };
  const vault = findVault(filePath);
  const canPrompt = hasHc();
  const canReview = inGit && Bun.which('gh') !== null;
  // In review mode, the page shows the file at the head of the pull request, where review comments go.
  let reviewHead: { pullRequest: Review.PullRequest; content: string } | null = null;
  let renderedSource = '';

  let pinnedCommit: string | null = null;
  let history = inGit ? listBranchHistory(gitFile.root, gitFile.relativePath) : [];

  // A base commit matches the step whose version of the file is the same.
  const findHistoryCommit = (commit: string): string | null => {
    if (history.some((entry) => entry.commit === commit)) {
      return commit;
    }
    const touched = lastCommitTouching(gitFile.root, commit, gitFile.relativePath);
    const match = history.find((entry) =>
      entry.forkPoint ? lastCommitTouching(gitFile.root, entry.commit, gitFile.relativePath) === touched : entry.commit === touched,
    );
    return match?.commit ?? null;
  };

  let baseCommit = inGit ? resolveCommit(gitFile.root, config.base) : '';
  let baseContent = inGit ? readFileAtCommit(gitFile.root, baseCommit, gitFile.relativePath) : null;
  let baseDate = inGit ? authorDate(gitFile.root, baseCommit) : null;
  let historyCommit = inGit ? findHistoryCommit(baseCommit) : null;
  // Without a git repository, the file is compared with itself, so nothing shows as changed.
  const diffBase = (source: string): string | null => (inGit ? baseContent : source);
  let snapshot: Snapshot = {
    base: config.base,
    baseCommit,
    baseDate,
    baseMissing: baseContent === null,
    history,
    pinnedCommit,
    historyCommit,
    inGit,
    canOpen: vault !== null,
    canPrompt,
    canReview,
    canEdit: true,
    canCommit: false,
    reviewOnly: false,
    reviewHead: null,
    source: '',
    html: null,
    stats: null,
    error: null,
  };

  const loadBase = (commit: string): void => {
    baseCommit = commit;
    baseContent = readFileAtCommit(gitFile.root, commit, gitFile.relativePath);
    baseDate = authorDate(gitFile.root, commit);
    historyCommit = findHistoryCommit(commit);
  };

  const rebuild = (): Snapshot => {
    const base = {
      base: config.base,
      baseCommit,
      baseDate,
      baseMissing: baseContent === null,
      history,
      pinnedCommit,
      historyCommit,
      inGit,
      canOpen: vault !== null,
      canPrompt,
      canReview,
      canEdit: true,
      canCommit: inGit && reviewHead === null && hasUncommittedChanges(gitFile.root, gitFile.relativePath),
      reviewOnly: false,
      reviewHead: reviewHead && { branch: reviewHead.pullRequest.headRefName, commit: reviewHead.pullRequest.headRefOid },
    };
    try {
      const source = reviewHead?.content ?? Fs.readFileSync(filePath, 'utf8');
      const result = renderMarkdownDiff(diffBase(source), source);
      renderedSource = source;
      return { ...base, source: normalizeSource(source), html: result.html, stats: result.stats, error: null };
    } catch (error) {
      return { ...base, source: snapshot.source, html: snapshot.html, stats: snapshot.stats, error: String(error) };
    }
  };

  snapshot = rebuild();
  const server = startServer(config.port, gitFile.relativePath, {
    current: () => snapshot,
    selectBase: (commit) => {
      if (!inGit) {
        throw new Error(`${gitFile.relativePath} is not in a git repository`);
      }
      if (commit !== null && !history.some((entry) => entry.commit === commit)) {
        throw new Error(`Commit "${commit}" is not a diff base of ${gitFile.relativePath} on this branch`);
      }
      pinnedCommit = commit;
      loadBase(commit ?? resolveCommit(gitFile.root, config.base));
      snapshot = rebuild();
      server.send(snapshot);
    },
    // Positions come from the rendered page, so they are resolved against the source that was rendered.
    openSource: async (target) => {
      if (vault === null) {
        throw new Error(`${gitFile.relativePath} is not in an Obsidian vault`);
      }
      await openInObsidian(vault, locateClick(renderedSource, target));
    },
    // Without a Claude Code pane on the file, a new one starts at the repository root.
    promptClaude: async (request) => {
      const panes = await listPanes();
      const pane = pickClaudePane(panes.filter((item) => item.agent === 'claude-code'), realPath);
      const cwd = pane?.cwd ?? gitFile.root;
      const source = normalizeSource(renderedSource);
      const from = Math.min(request.from, source.length);
      const to = Math.min(request.to, source.length);
      const text = buildPrompt({
        path: Path.relative(cwd, realPath),
        startLine: positionAt(source, from).line + 1,
        endLine: positionAt(source, Math.max(from, to - 1)).line + 1,
        source: source.slice(from, to).trim() || request.text.trim(),
        prompt: request.prompt,
      });
      if (pane === null) {
        return startClaude(cwd, text, pickHerdrSpace(panes, gitFile.root));
      }
      await sendToClaude(pane, text);
      return pane.address;
    },
    ...createReviewHandlers({
      cwd: gitFile.root,
      path: gitFile.relativePath,
      findPullRequest: () => Review.findPullRequest(gitFile.root),
      renderedSource: () => renderedSource,
      headContent: (pullRequest) => reviewHead?.content ?? readFileAtCommit(gitFile.root, pullRequest.headRefOid, gitFile.relativePath),
      showHead: (pullRequest) => showPullRequestHead(pullRequest),
      showsHead: () => reviewHead !== null,
      shownHead: () => reviewHead?.pullRequest.headRefOid ?? null,
    }),
    stopReview: () => {
      if (reviewHead !== null) {
        reviewHead = null;
        snapshot = rebuild();
        server.send(snapshot);
      }
    },
    // The watcher picks up the write and pushes the new render, so there is no rebuild here.
    patchSource: (patches) => {
      const current = Fs.readFileSync(filePath, 'utf8');
      Fs.writeFileSync(filePath, applyPatches(current, patches));
    },
    // The new commit changes the history and the `HEAD` base, so the base is checked at once.
    commitFile: () => {
      if (!inGit) {
        throw new Error(`${gitFile.relativePath} is not in a git repository`);
      }
      if (!hasUncommittedChanges(gitFile.root, gitFile.relativePath)) {
        throw new Error(`${gitFile.relativePath} has no uncommitted changes`);
      }
      commitFile(gitFile.root, gitFile.relativePath, `Update \`${gitFile.relativePath}\``);
      pollBase();
      snapshot = rebuild();
      server.send(snapshot);
    },
    renderSource: (source) => {
      const result = renderMarkdownDiff(diffBase(source), source);
      return { ...snapshot, source: normalizeSource(source), html: result.html, stats: result.stats, error: null };
    },
  });

  const showPullRequestHead = async (pullRequest: Review.PullRequest): Promise<void> => {
    await Review.fetchPullRequestHead(gitFile.root, pullRequest);
    const content = readFileAtCommit(gitFile.root, pullRequest.headRefOid, gitFile.relativePath);
    if (content === null) {
      throw new Error(`${gitFile.relativePath} is not in the pull request head (${pullRequest.headRefOid.slice(0, 8)}).`);
    }
    reviewHead = { pullRequest, content };
    snapshot = rebuild();
    server.send(snapshot);
  };

  let timer: Timer | null = null;
  const scheduleRebuild = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      if (!Fs.existsSync(filePath)) {
        return;
      }
      snapshot = rebuild();
      server.send(snapshot);
    }, DEBOUNCE_MS);
  };

  // Watch the directory, not the file: editors that save with an atomic rename replace the watched inode.
  const fileName = Path.basename(filePath);
  Fs.watch(Path.dirname(filePath), (_event, changed) => {
    if (changed === null || Path.basename(changed.toString()) === fileName) {
      scheduleRebuild();
    }
  });

  const pollBase = (): void => {
    try {
      const latest = listBranchHistory(gitFile.root, gitFile.relativePath);
      const historyChanged = latest.map((entry) => entry.commit).join() !== history.map((entry) => entry.commit).join();
      history = latest;
      const commit = pinnedCommit ?? resolveCommit(gitFile.root, config.base);
      if (commit !== baseCommit) {
        loadBase(commit);
        scheduleRebuild();
      } else if (historyChanged) {
        historyCommit = findHistoryCommit(baseCommit);
        scheduleRebuild();
      }
    } catch (error) {
      console.error(String(error));
    }
  };
  if (inGit) {
    setInterval(pollBase, BASE_POLL_INTERVAL_MS);
  }

  console.log(inGit ? `mdlive: ${gitFile.relativePath} vs ${config.base} (${baseCommit.slice(0, 8)})` : `mdlive: ${gitFile.relativePath} (not in a git repository, no diff)`);
  console.log(`mdlive: ${server.url}`);
  return { url: server.url, fileLabel: gitFile.relativePath };
};
