import { normalizeSource } from './sourcePosition';

export type SourcePatch = {
  /** Offset where the replaced range starts, in the source with line endings normalized. */
  from: number;
  /** Offset where the replaced range ends. */
  to: number;
  /** New text for the range. */
  text: string;
  /** Text expected right before the range. */
  before: string;
  /** Text expected in the range. */
  removed: string;
  /** Text expected right after the range. */
  after: string;
};

const CHANGED_MESSAGE = 'The file changed where you edited it since the page was rendered. Your edit was not saved.';

const CONTEXT_LENGTHS = [Infinity, 16, 12, 8, 6, 4];

const findUnique = (source: string, text: string): number => {
  const first = source.indexOf(text);
  return text !== '' && first !== -1 && source.indexOf(text, first + 1) === -1 ? first : -1;
};

// When text was added or removed before the patch, the patch is found again by its context. A change next to the
// patch can overlap the context, so shorter contexts are tried too, on both sides and on one side, as long as the
// match is unique.
const locatePatch = (source: string, patch: SourcePatch): number => {
  const atOffset =
    source.slice(patch.from - patch.before.length, patch.from) === patch.before &&
    source.slice(patch.from, patch.to) === patch.removed &&
    source.slice(patch.to, patch.to + patch.after.length) === patch.after;
  if (atOffset) {
    return patch.from;
  }
  for (const length of CONTEXT_LENGTHS) {
    const before = length === Infinity ? patch.before : patch.before.slice(-length);
    const after = length === Infinity ? patch.after : patch.after.slice(0, length);
    const candidates: [string, string][] = [[before, after], [before, patch.after], [patch.before, after]];
    for (const [contextBefore, contextAfter] of candidates) {
      const found = findUnique(source, contextBefore + patch.removed + contextAfter);
      if (found !== -1) {
        return found + contextBefore.length;
      }
    }
  }
  throw new Error(CHANGED_MESSAGE);
};

const applyNormalized = (source: string, patch: SourcePatch): string => {
  const from = locatePatch(source, patch);
  return source.slice(0, from) + normalizeSource(patch.text) + source.slice(from + patch.removed.length);
};

/**
 * Replaces a range of `markdown` with the patch text and returns the new file content.
 * When the text before the range changed, the range is found again by the text around it.
 * Throws when that text is not found exactly once, which means the file changed where the patch applies.
 */
export const applyPatch = (markdown: string, patch: SourcePatch): string => applyPatches(markdown, [patch]);

/**
 * Applies patches in order, each one to the result of the previous one. See {@link applyPatch}.
 */
export const applyPatches = (markdown: string, patches: SourcePatch[]): string => {
  const result = patches.reduce(applyNormalized, normalizeSource(markdown));
  return markdown.includes('\r\n') ? result.replaceAll('\n', '\r\n') : result;
};
