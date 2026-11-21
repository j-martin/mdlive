import * as Diff from 'diff';

const TOKEN_PATTERN = /<[^>]*>|&#?\w+;|\s+|[\p{L}\p{N}_]+|[\s\S]/gu;
const MAX_EDIT_LENGTH = 4000;
const MAX_GROUPED_WORDS = 2;
const SENTENCE_BREAK = /^[.!?;:]$/;

export type HtmlDiffResult = {
  html: string;
  similarity: number;
};

const tokenize = (html: string): string[] => html.match(TOKEN_PATTERN) ?? [];

const isTag = (token: string): boolean => token.startsWith('<');

const isWord = (token: string): boolean => !isTag(token) && token.trim() !== '';

const countWords = (tokens: string[]): number => tokens.filter(isWord).length;

/**
 * Wraps each run of text tokens in `<ins>` or `<del>`.
 * Tags of the removed side are dropped so that the output keeps the tag structure of the new HTML only.
 */
const wrapRuns = (tokens: string[], tagName: 'ins' | 'del'): string => {
  const keepTags = tagName === 'ins';
  let output = '';
  let run: string[] = [];

  const flushRun = (): void => {
    if (run.length === 0) {
      return;
    }
    const text = run.join('');
    if (text.trim() !== '') {
      output += `<${tagName}>${text}</${tagName}>`;
    } else if (keepTags) {
      output += text;
    }
    run = [];
  };

  for (const token of tokens) {
    if (isTag(token)) {
      flushRun();
      if (keepTags) {
        output += token;
      }
    } else {
      run.push(token);
    }
  }
  flushRun();
  return output;
};

type Segment = { kind: 'equal'; tokens: string[] } | { kind: 'change'; removed: string[]; added: string[] };

const toSegments = (changes: Diff.ArrayChange<string>[]): Segment[] => {
  const segments: Segment[] = [];
  for (const change of changes) {
    const last = segments.at(-1);
    if (!change.added && !change.removed) {
      segments.push({ kind: 'equal', tokens: change.value });
    } else if (last?.kind === 'change') {
      (change.added ? last.added : last.removed).push(...change.value);
    } else {
      segments.push({ kind: 'change', removed: change.removed ? [...change.value] : [], added: change.added ? [...change.value] : [] });
    }
  }
  return segments;
};

const changesText = (segment: Segment | undefined): boolean =>
  segment?.kind === 'change' && countWords(segment.removed) + countWords(segment.added) > 0;

const isSmallGap = (tokens: string[]): boolean =>
  countWords(tokens) <= MAX_GROUPED_WORDS && !tokens.some((token) => isTag(token) || SENTENCE_BREAK.test(token));

/**
 * Merges changes that only a few words of the same sentence separate, so that the result shows one deletion
 * followed by one addition instead of alternating them word by word. The words in between go to both sides.
 * Changes of tags only, such as an attribute that moved, are not text changes and are never merged.
 */
const groupChanges = (segments: Segment[]): Segment[] => {
  const grouped: Segment[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const previous = grouped.at(-1);
    const next = segments[index + 1];
    if (segment.kind === 'equal' && previous?.kind === 'change' && next?.kind === 'change' && changesText(previous) &&
      changesText(next) && isSmallGap(segment.tokens)) {
      previous.removed.push(...segment.tokens, ...next.removed);
      previous.added.push(...segment.tokens, ...next.added);
      index += 1;
    } else {
      grouped.push(segment);
    }
  }
  return grouped;
};

const isTagOrSpace = (token: string): boolean => isTag(token) || token.trim() === '';

/**
 * Renders a change as the deletion followed by the addition. The tags that open and close the added side
 * stay around both, so that the deletion is inside the same elements as the addition.
 */
const renderChange = (removed: string[], added: string[]): string => {
  let first = 0;
  while (first < added.length && isTagOrSpace(added[first])) {
    first += 1;
  }
  let last = added.length;
  while (last > first && isTagOrSpace(added[last - 1])) {
    last -= 1;
  }
  return (
    added.slice(0, first).join('') +
    wrapRuns(removed, 'del') +
    wrapRuns(added.slice(first, last), 'ins') +
    added.slice(last).join('')
  );
};

/**
 * Computes a word-level diff between two HTML fragments.
 * The result uses the tags of `newHtml` and marks text changes with `<ins>` and `<del>`.
 * Returns `null` when the fragments are too different to diff in a reasonable time.
 */
export const diffHtml = (oldHtml: string, newHtml: string): HtmlDiffResult | null => {
  const oldTokens = tokenize(oldHtml);
  const newTokens = tokenize(newHtml);
  const changes = Diff.diffArrays(oldTokens, newTokens, { maxEditLength: MAX_EDIT_LENGTH });
  if (changes === undefined) {
    return null;
  }

  let equalWords = 0;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      equalWords += countWords(change.value);
    }
  }
  const html = groupChanges(toSegments(changes))
    .map((segment) => (segment.kind === 'equal' ? segment.tokens.join('') : renderChange(segment.removed, segment.added)))
    .join('');

  const totalWords = Math.max(countWords(oldTokens), countWords(newTokens));
  return { html, similarity: totalWords === 0 ? 1 : equalWords / totalWords };
};
