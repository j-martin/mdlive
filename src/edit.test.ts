import { describe, expect, test } from 'bun:test';
import { applyPatch, applyPatches, type SourcePatch } from './edit';

const SOURCE = '# Title\n\nFirst paragraph.\n';

const patchOf = (source: string, from: number, to: number, text: string): SourcePatch => ({
  from,
  to,
  text,
  before: source.slice(Math.max(0, from - 8), from),
  removed: source.slice(from, to),
  after: source.slice(to, to + 8),
});

describe('applyPatch', () => {
  test('inserts text', () => {
    expect(applyPatch(SOURCE, patchOf(SOURCE, 14, 14, ' new'))).toBe('# Title\n\nFirst new paragraph.\n');
  });

  test('keeps spaces at the end of the inserted text', () => {
    expect(applyPatch(SOURCE, patchOf(SOURCE, 13, 13, ' '))).toBe('# Title\n\nFirs t paragraph.\n');
  });

  test('deletes text', () => {
    expect(applyPatch(SOURCE, patchOf(SOURCE, 9, 15, ''))).toBe('# Title\n\nparagraph.\n');
  });

  test('applies a patch next to a change when a shorter context is still unique', () => {
    const patch = patchOf(SOURCE, 14, 14, ' new');
    expect(applyPatch(SOURCE.replace('First', 'Fiirst'), patch)).toBe('# Title\n\nFiirst new paragraph.\n');
  });

  test('refuses a patch when its context is gone', () => {
    const patch = patchOf(SOURCE, 14, 14, ' new');
    expect(() => applyPatch('# Other\n\nSomething else entirely.\n', patch)).toThrow('changed');
  });

  test('finds the patch again when text was added before it', () => {
    const patch = patchOf(SOURCE, 14, 14, ' new');
    expect(applyPatch(SOURCE.replace('# Title', '# Longer title'), patch)).toBe('# Longer title\n\nFirst new paragraph.\n');
  });

  test('finds the patch again when the change before it overlaps its context', () => {
    const patch = patchOf(SOURCE, 12, 12, 'Q');
    expect(applyPatch(SOURCE.replace('# Title', '# Title from elsewhere'), patch)).toBe(
      '# Title from elsewhere\n\nFirQst paragraph.\n',
    );
  });

  test('refuses a moved patch whose context appears more than once', () => {
    const patch = patchOf(SOURCE, 14, 14, ' new');
    expect(() => applyPatch(`# T\n\n${SOURCE}${SOURCE}`, patch)).toThrow('changed');
  });

  test('refuses a patch when the removed text changed', () => {
    const patch = patchOf(SOURCE, 9, 14, '');
    expect(() => applyPatch(SOURCE.replace('First', 'Worst'), patch)).toThrow('changed');
  });

  test('keeps Windows line endings', () => {
    const windows = SOURCE.replaceAll('\n', '\r\n');
    expect(applyPatch(windows, patchOf(SOURCE, 25, 25, '\n\nNew paragraph.'))).toBe(
      '# Title\r\n\r\nFirst paragraph.\r\n\r\nNew paragraph.\r\n',
    );
  });
});

describe('applyPatches', () => {
  test('applies patches in order', () => {
    const first = patchOf(SOURCE, 14, 14, ' new');
    const afterFirst = applyPatch(SOURCE, first);
    const second = patchOf(afterFirst, 9, 14, 'Last');
    expect(applyPatches(SOURCE, [first, second])).toBe('# Title\n\nLast new paragraph.\n');
  });
});
