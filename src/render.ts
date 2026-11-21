import * as Diff from 'diff';
import * as Marked from 'marked';
import { diffHtml } from './htmlDiff';

const MIN_SIMILARITY = 0.3;
const IGNORED_BLOCK_TYPES = new Set(['space', 'def']);

type ChangeKind = 'added' | 'removed' | 'modified';

export type DiffStats = Record<ChangeKind, number>;

export type RenderResult = {
  html: string;
  stats: DiffStats;
};

type SourceRange = { start: number; end: number };

type Positions = Map<Marked.Token, SourceRange>;

const NO_POSITIONS: Positions = new Map();

// Offsets come from the `raw` lengths of every token, so they index the source with line endings normalized.
const toBlocks = (markdown: string): { blocks: Marked.Token[]; positions: Positions } => {
  const positions: Positions = new Map();
  let offset = 0;
  const tokens = Marked.lexer(markdown);
  for (const token of tokens) {
    positions.set(token, { start: offset, end: offset + token.raw.length });
    offset += token.raw.length;
  }
  return { blocks: tokens.filter((token) => !IGNORED_BLOCK_TYPES.has(token.type)), positions };
};

const annotate = (html: string, range: SourceRange | undefined): string =>
  range === undefined ? html : html.replace(/^<([a-zA-Z][\w-]*)/, `<$1 data-src="${range.start}-${range.end}"`);

/**
 * Renders each block on its own so that its first tag can carry its source range as `data-src`.
 */
const renderBlocks = (blocks: Marked.Token[], positions: Positions): string =>
  blocks.map((block) => annotate(Marked.parser([block]), positions.get(block))).join('');

const blockKey = (block: Marked.Token): string => `${block.type}\n${block.raw.trim()}`;

const wrapChange = (kind: ChangeKind, html: string): string =>
  `<div class="change change-${kind}">${html}</div>`;

const renderHunk = (removed: Marked.Token[], added: Marked.Token[], positions: Positions, stats: DiffStats): string => {
  const oldHtml = renderBlocks(removed, NO_POSITIONS);
  const newHtml = renderBlocks(added, positions);
  if (removed.length === 0) {
    stats.added += 1;
    return wrapChange('added', newHtml);
  }
  if (added.length === 0) {
    stats.removed += 1;
    return wrapChange('removed', oldHtml);
  }

  const result = diffHtml(oldHtml, newHtml);
  if (result === null || result.similarity < MIN_SIMILARITY) {
    stats.removed += 1;
    stats.added += 1;
    return wrapChange('removed', oldHtml) + wrapChange('added', newHtml);
  }
  stats.modified += 1;
  return wrapChange('modified', result.html);
};

/**
 * Renders `newMarkdown` to HTML with the changes from `oldMarkdown` shown inline.
 * Blocks are compared first. Changed blocks then get a word-level diff.
 * If `oldMarkdown` is `null`, the full document is shown as added.
 */
export const renderMarkdownDiff = (oldMarkdown: string | null, newMarkdown: string): RenderResult => {
  const stats: DiffStats = { added: 0, removed: 0, modified: 0 };
  const { blocks: newBlocks, positions } = toBlocks(newMarkdown);
  if (oldMarkdown === null) {
    stats.added = newBlocks.length > 0 ? 1 : 0;
    return { html: wrapChange('added', renderBlocks(newBlocks, positions)), stats };
  }

  const { blocks: oldBlocks } = toBlocks(oldMarkdown);
  const changes = Diff.diffArrays(oldBlocks.map(blockKey), newBlocks.map(blockKey));
  const parts: string[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let pendingRemoved: Marked.Token[] = [];
  let pendingAdded: Marked.Token[] = [];

  const flushHunk = (): void => {
    if (pendingRemoved.length === 0 && pendingAdded.length === 0) {
      return;
    }
    parts.push(renderHunk(pendingRemoved, pendingAdded, positions, stats));
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const change of changes) {
    const count = change.value.length;
    if (change.added) {
      pendingAdded.push(...newBlocks.slice(newIndex, newIndex + count));
      newIndex += count;
    } else if (change.removed) {
      pendingRemoved.push(...oldBlocks.slice(oldIndex, oldIndex + count));
      oldIndex += count;
    } else {
      flushHunk();
      parts.push(renderBlocks(newBlocks.slice(newIndex, newIndex + count), positions));
      oldIndex += count;
      newIndex += count;
    }
  }
  flushHunk();

  return { html: parts.join(''), stats };
};
