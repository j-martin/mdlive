import { describe, expect, test } from 'bun:test';
import { diffHtml } from './htmlDiff';

describe('diffHtml', () => {
  test('returns the same HTML when nothing changed', () => {
    expect(diffHtml('<p>hello world</p>', '<p>hello world</p>')?.html).toBe('<p>hello world</p>');
  });

  test('marks a replaced word with del and ins', () => {
    expect(diffHtml('<p>hello world</p>', '<p>hello there</p>')?.html).toBe(
      '<p>hello <del>world</del><ins>there</ins></p>',
    );
  });

  test('keeps only the tags of the new HTML', () => {
    expect(diffHtml('<p><strong>bold</strong></p>', '<p>bold</p>')?.html).toBe('<p>bold</p>');
  });

  test('wraps added text inside new tags', () => {
    expect(diffHtml('<p>a</p>', '<p>a</p><p>b</p>')?.html).toBe('<p>a</p><p><ins>b</ins></p>');
  });

  test('gives a similarity of 1 for identical text', () => {
    expect(diffHtml('<p>same text</p>', '<p>same text</p>')?.similarity).toBe(1);
  });

  test('gives a similarity of 0 for unrelated text', () => {
    expect(diffHtml('<p>alpha beta</p>', '<p>gamma delta</p>')?.similarity).toBe(0);
  });

  test('groups changes separated by a space into one deletion and one addition', () => {
    expect(diffHtml('<p>a b</p>', '<p>c d</p>')?.html).toBe('<p><del>a b</del><ins>c d</ins></p>');
  });

  test('groups changes separated by a few unchanged words in the same sentence', () => {
    expect(diffHtml('<p>The quick brown fox jumps.</p>', '<p>The slow brown cat jumps.</p>')?.html).toBe(
      '<p>The <del>quick brown fox</del><ins>slow brown cat</ins> jumps.</p>',
    );
  });

  test('does not group changes separated by many unchanged words', () => {
    expect(diffHtml('<p>one a b c two</p>', '<p>uno a b c dos</p>')?.html).toBe(
      '<p><del>one</del><ins>uno</ins> a b c <del>two</del><ins>dos</ins></p>',
    );
  });

  test('does not group changes across sentences', () => {
    expect(diffHtml('<p>One. Two</p>', '<p>Uno. Dos</p>')?.html).toBe(
      '<p><del>One</del><ins>Uno</ins>. <del>Two</del><ins>Dos</ins></p>',
    );
  });

  test('does not group changes across tags', () => {
    expect(diffHtml('<p>a <em>b</em></p>', '<p>c <em>d</em></p>')?.html).toBe(
      '<p><del>a</del><ins>c</ins> <em><del>b</del><ins>d</ins></em></p>',
    );
  });

  test('counts the grouped unchanged words in the similarity', () => {
    expect(diffHtml('<p>a same b</p>', '<p>c same d</p>')?.similarity).toBeCloseTo(1 / 3);
  });

  test('keeps a grouped deletion inside the tags of the new HTML', () => {
    expect(diffHtml('<p>a b c.</p>', '<p data-src="1">d e c.</p>')?.html).toBe('<p data-src="1"><del>a b</del><ins>d e</ins> c.</p>');
  });
});

