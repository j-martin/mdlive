// The page runs locateOffset, locateText and listContinuation too, through Function.prototype.toString.
// Keep them self-contained: no reference to anything else in this module.

export type ClickTarget = {
  /** Offset where the clicked block starts in the source. */
  start: number;
  /** Offset where the clicked block ends in the source. */
  end: number;
  /** Rendered texts of the block in document order, up to and including the clicked text. */
  texts: string[];
  /** Offset of the click in the last text. */
  offset: number;
};

export type BlockTexts = {
  /** Offset where the block starts in the source. */
  start: number;
  /** Offset where the block ends in the source. */
  end: number;
  /** All rendered texts of the block in document order. */
  texts: string[];
};

export type TextPosition = {
  /** Index of the text in `BlockTexts.texts`. */
  index: number;
  /** Offset in that text. */
  offset: number;
};

export type SourcePosition = {
  /** Zero-based line. */
  line: number;
  /** Zero-based column in UTF-16 code units. */
  ch: number;
};

/**
 * Normalizes line endings the same way `marked` does, so offsets match the rendered blocks.
 */
export const normalizeSource = (source: string): string => source.replace(/\r\n|\r/g, '\n');

const toPosition = (source: string, offset: number): SourcePosition => {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length - 1, ch: offset - lineStart };
};

/**
 * Finds the offset of a click in the source, with line endings normalized.
 * Each rendered text is searched in order in the block source, so Markdown syntax between texts is skipped
 * and repeated words resolve to the right occurrence. When the clicked text is not found in the source
 * (escapes, entities), the position falls back to the end of the last text that was found.
 */
export const locateOffset = (markdown: string, target: ClickTarget): number => {
  const source = markdown.replace(/\r\n|\r/g, '\n');
  const end = Math.min(target.end, source.length);
  let cursor = Math.max(0, Math.min(target.start, end));
  target.texts.forEach((text, index) => {
    const core = text.trim();
    if (core === '') {
      return;
    }
    const found = source.indexOf(core, cursor);
    if (found === -1 || found + core.length > end) {
      return;
    }
    const isClicked = index === target.texts.length - 1;
    if (isClicked) {
      const leading = text.length - text.trimStart().length;
      const inCore = Math.max(0, Math.min(target.offset - leading, core.length));
      // A click in the trailing whitespace keeps its place when the source has the same whitespace there.
      const wanted = Math.max(0, target.offset - leading - core.length);
      const tail = source.slice(found + core.length, Math.min(end, found + core.length + wanted));
      const spaces = tail.length - tail.trimStart().length;
      cursor = found + inCore + (inCore === core.length ? spaces : 0);
    } else {
      cursor = found + core.length;
    }
  });
  return cursor;
};

/**
 * Finds the rendered text and the offset in it that show the source `offset`. It is the reverse of
 * {@link locateOffset} and matches the texts the same way. An offset inside Markdown syntax goes to the start
 * of the next text, and an offset after the last text goes to its end. Returns `null` when no text matches.
 */
export const locateText = (markdown: string, block: BlockTexts, offset: number): TextPosition | null => {
  const source = markdown.replace(/\r\n|\r/g, '\n');
  const end = Math.min(block.end, source.length);
  let cursor = Math.max(0, Math.min(block.start, end));
  let last: TextPosition | null = null;
  for (let index = 0; index < block.texts.length; index += 1) {
    const text = block.texts[index];
    const core = text.trim();
    const found = core === '' ? -1 : source.indexOf(core, cursor);
    if (found === -1 || found + core.length > end) {
      continue;
    }
    const leading = text.length - text.trimStart().length;
    if (offset < found) {
      return { index, offset: leading };
    }
    const trailing = text.length - leading - core.length;
    const tail = source.slice(found + core.length, Math.min(end, found + core.length + trailing));
    const spaces = tail.length - tail.trimStart().length;
    if (offset <= found + core.length + spaces) {
      return { index, offset: leading + offset - found };
    }
    cursor = found + core.length;
    last = { index, offset: leading + core.length };
  }
  return last;
};

/**
 * Gives the text that Enter inserts at `offset`: the next item marker in a list, a single line break in a
 * fenced code block, and a blank line everywhere else.
 */
export const listContinuation = (markdown: string, offset: number): string => {
  const before = markdown.replace(/\r\n|\r/g, '\n').slice(0, offset);
  const fences = before.match(/^\s*(```|~~~)/gm) ?? [];
  if (fences.length % 2 === 1) {
    return '\n';
  }
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const item = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line);
  if (item === null) {
    return '\n\n';
  }
  const [, indent, bullet, number, delimiter, space, task] = item;
  const marker = number === undefined ? bullet : `${Number(number) + 1}${delimiter}`;
  return `\n${indent}${marker}${space}${task === undefined ? '' : '[ ] '}`;
};

/**
 * Rewrites the spaces of `text` between `from` and `to` so they stay visible on the page: a space at either end
 * of the text or next to other whitespace becomes a non-breaking space, and any other space becomes a plain space.
 * This is what browsers do while typing, because the page hides a space at the end of a line or a run of spaces.
 */
export const visibleSpaces = (text: string, from: number, to: number): string => {
  const chars = text.split('');
  for (let index = Math.max(0, from); index < Math.min(to, chars.length); index += 1) {
    if (chars[index] !== ' ' && chars[index] !== '\u00a0') {
      continue;
    }
    const previous = chars[index - 1];
    const next = chars[index + 1];
    const hidden = previous === undefined || next === undefined || /\s/.test(previous) || /\s/.test(next);
    chars[index] = hidden ? '\u00a0' : ' ';
  }
  return chars.join('');
};

/**
 * Gives the line and column of an offset in the source, with line endings normalized.
 */
export const positionAt = (markdown: string, offset: number): SourcePosition => toPosition(normalizeSource(markdown), offset);

/**
 * Finds the line and column of a click in the source. See {@link locateOffset}.
 */
export const locateClick = (markdown: string, target: ClickTarget): SourcePosition =>
  toPosition(normalizeSource(markdown), locateOffset(markdown, target));
