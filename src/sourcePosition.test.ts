import { describe, expect, test } from 'bun:test';
import { listContinuation, locateClick, locateOffset, locateText } from './sourcePosition';

const blockOf = (source: string, block: string): { start: number; end: number } => {
  const start = source.indexOf(block);
  return { start, end: start + block.length };
};

describe('locateClick', () => {
  test('finds the clicked character in a plain paragraph', () => {
    const source = '# Title\n\nFirst paragraph.\n';
    const click = { ...blockOf(source, 'First paragraph.'), texts: ['First paragraph.'], offset: 6 };
    expect(locateClick(source, click)).toEqual({ line: 2, ch: 6 });
  });

  test('skips the Markdown syntax around formatted text', () => {
    const source = 'Some *em* and **bold** text.';
    const click = { start: 0, end: source.length, texts: ['Some ', 'em', ' and ', 'bold'], offset: 2 };
    expect(locateClick(source, click)).toEqual({ line: 0, ch: source.indexOf('bold') + 2 });
  });

  test('finds the right occurrence of a repeated word', () => {
    const source = 'go *go* go';
    const click = { start: 0, end: source.length, texts: ['go ', 'go', ' go'], offset: 1 };
    expect(locateClick(source, click)).toEqual({ line: 0, ch: 8 });
  });

  test('finds a click in a later line of a block', () => {
    const source = '- a\n- b\n';
    const click = { start: 0, end: source.length, texts: ['a', 'b'], offset: 0 };
    expect(locateClick(source, click)).toEqual({ line: 1, ch: 2 });
  });

  test('ignores the whitespace around a text', () => {
    const source = '| a | b |';
    const click = { start: 0, end: source.length, texts: [' b '], offset: 1 };
    expect(locateClick(source, click)).toEqual({ line: 0, ch: 6 });
  });

  test('falls back to the end of the last match when the clicked text is not in the source', () => {
    const source = 'Hello *there* &copy;';
    const click = { start: 0, end: source.length, texts: ['Hello ', 'there', ' ©'], offset: 1 };
    expect(locateClick(source, click)).toEqual({ line: 0, ch: source.indexOf('there') + 'there'.length });
  });

  test('stays inside the block', () => {
    const source = 'first\n\nsecond first';
    const click = { ...blockOf(source, 'second first'), texts: ['second first'], offset: 7 };
    expect(locateClick(source, click)).toEqual({ line: 2, ch: 7 });
  });
});

describe('locateText', () => {
  const source = 'Some *em* and **bold** text.';
  const block = { start: 0, end: source.length, texts: ['Some ', 'em', ' and ', 'bold', ' text.'] };

  test('finds the text that contains the offset', () => {
    expect(locateText(source, block, source.indexOf('bold') + 2)).toEqual({ index: 3, offset: 2 });
  });

  test('puts an offset right after a text at the end of that text', () => {
    expect(locateText(source, block, source.indexOf('bold') + 4)).toEqual({ index: 3, offset: 4 });
  });

  test('puts an offset inside Markdown syntax at the start of the next text', () => {
    expect(locateText(source, block, source.indexOf('**bold') + 1)).toEqual({ index: 3, offset: 0 });
  });

  test('keeps the whitespace around a text', () => {
    const table = { start: 0, end: 9, texts: [' a ', ' b '] };
    expect(locateText('| a | b |', table, 6)).toEqual({ index: 1, offset: 1 });
  });

  test('puts an offset after the last text at the end of the last text', () => {
    expect(locateText('- a\n- b\n', { start: 0, end: 8, texts: ['a', 'b'] }, 8)).toEqual({ index: 1, offset: 1 });
  });

  test('returns null for a block without text', () => {
    expect(locateText('---\n', { start: 0, end: 4, texts: [] }, 1)).toBeNull();
  });
});

describe('listContinuation', () => {
  test('starts a new paragraph outside a list', () => {
    expect(listContinuation('Some text', 9)).toBe('\n\n');
  });

  test('repeats a bullet', () => {
    expect(listContinuation('- one', 5)).toBe('\n- ');
  });

  test('keeps the indentation of a nested bullet', () => {
    expect(listContinuation('- one\n  * two', 13)).toBe('\n  * ');
  });

  test('increments a numbered item', () => {
    expect(listContinuation('9. nine', 7)).toBe('\n10. ');
  });

  test('adds an empty checkbox after a task', () => {
    expect(listContinuation('- [x] done', 10)).toBe('\n- [ ] ');
  });

  test('inserts a single line break inside a code block', () => {
    expect(listContinuation('```\ncode', 8)).toBe('\n');
  });
});

describe('page copies', () => {
  test('work after a toString round trip', () => {
    const copy = new Function(`return ${locateOffset.toString()}`)() as typeof locateOffset;
    const text = new Function(`return ${locateText.toString()}`)() as typeof locateText;
    const list = new Function(`return ${listContinuation.toString()}`)() as typeof listContinuation;
    expect(copy('go *go* go', { start: 0, end: 10, texts: ['go ', 'go', ' go'], offset: 1 })).toBe(8);
    expect(text('go *go* go', { start: 0, end: 10, texts: ['go ', 'go', ' go'] }, 8)).toEqual({ index: 2, offset: 1 });
    expect(list('- one', 5)).toBe('\n- ');
  });
});

describe('trailing whitespace', () => {
  test('keeps a click after a trailing space of a text', () => {
    const source = 'Version **draft**';
    expect(locateOffset(source, { start: 0, end: source.length, texts: ['Version '], offset: 8 })).toBe(8);
  });

  test('finds a source offset after a trailing space of a text', () => {
    const source = 'Version **draft**';
    expect(locateText(source, { start: 0, end: source.length, texts: ['Version ', 'draft'] }, 8)).toEqual({ index: 0, offset: 8 });
  });
});
