import { EDITOR_SCRIPT } from './editorScript';
import { PROMPT_SCRIPT } from './promptScript';
import { REVIEW_SCRIPT } from './reviewScript';

const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const STYLE = `
:root {
  --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --border: #d1d9e0; --code-bg: #f6f8fa;
  --add-bg: #dafbe1; --add-fg: #116329; --add-bar: #1a7f37;
  --del-bg: #ffebe9; --del-fg: #82071e; --del-bar: #cf222e;
  --mod-bar: #9a6700; --focus: #0969da;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --border: #3d444d; --code-bg: #151b23;
    --add-bg: #12261e; --add-fg: #7ee787; --add-bar: #3fb950;
    --del-bg: #2d1316; --del-fg: #ffa198; --del-bar: #f85149;
    --mod-bar: #d29922; --focus: #4493f8;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
header { position: sticky; top: 0; z-index: 10; display: flex; flex-direction: column; gap: 8px;
  padding: 10px 24px; background: var(--bg); border-bottom: 1px solid var(--border); font-size: 13px; }
header .meta { color: var(--muted); }
header #base { display: flex; min-width: 0; max-width: 560px; white-space: nowrap; }
header #base .shrink { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
header #base .keep { flex: none; white-space: pre; }
header .stats span { margin-right: 10px; font-variant-numeric: tabular-nums; }
header .stats .s-added { color: var(--add-bar); } header .stats .s-removed { color: var(--del-bar); }
header .stats .s-modified { color: var(--mod-bar); }
header .title-row, header .controls { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; }
header .controls { gap: 8px 16px; }
header button { font: inherit; padding: 2px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--code-bg); color: var(--fg); cursor: pointer; }
header .history { display: flex; gap: 8px; align-items: center; }
header button:disabled { opacity: .4; cursor: default; }
header .history .count { color: var(--muted); font-variant-numeric: tabular-nums; }
body.editing main { caret-color: var(--focus); }
body.editing main:focus { outline: none; }
header button[aria-pressed="true"] { background: color-mix(in srgb, var(--focus) 22%, var(--code-bg)); border-color: var(--focus); }
header .mode { display: inline-flex; align-items: center; gap: 8px; }
header .mode-label { color: var(--muted); }
header .mode-buttons { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
header .mode-buttons button { border: 0; border-radius: 0; }
header .mode-buttons button + button { border-left: 1px solid var(--border); }
header .mode-buttons button[aria-pressed="true"] { background: var(--focus); color: #fff; }
body { position: relative; }
body.reviewing main { margin-left: max(24px, calc((100% - 380px - 900px) / 2)); margin-right: 380px; }
#review-panel { position: absolute; top: 0; right: 16px; width: 340px; }
.thread { position: absolute; left: 0; right: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--code-bg); font-size: 13px; line-height: 1.45; cursor: pointer; }
.thread.draft { border: 1px dashed var(--focus); }
.thread.resolved, .thread.outdated { opacity: .65; }
.thread .where { margin-bottom: 4px; color: var(--muted); font-size: 12px; }
.thread .comment + .comment { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.thread .meta-line { color: var(--muted); font-size: 12px; }
.thread .author { color: var(--fg); font-weight: 600; }
.thread .badge { margin-left: 6px; padding: 0 6px; border-radius: 9px; background: var(--focus); color: #fff; font-size: 11px; }
.thread .quote { margin: 4px 0; padding-left: 6px; border-left: 3px solid var(--border); color: var(--muted); white-space: pre-wrap; }
.thread .text { white-space: pre-wrap; }
.thread button { margin-top: 6px; padding: 1px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg);
  color: var(--fg); font: inherit; font-size: 12px; cursor: pointer; }
.thread .actions { display: flex; gap: 6px; align-items: center; }
.thread .actions .hint { color: var(--muted); font-size: 11px; margin-top: 6px; }
.thread .comment-editor textarea { display: block; width: 100%; margin-top: 4px; padding: 6px 8px; resize: vertical;
  border: 1px solid var(--focus); border-radius: 6px; background: var(--bg); color: var(--fg); font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.review-target { outline: 2px solid var(--focus); outline-offset: 4px; border-radius: 4px; }
header .review-row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
header .review-row input, header .review-row select { padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--code-bg); color: var(--fg); font: inherit; }
header .review-row input { flex: 1; min-width: 160px; }
#review-pr { color: var(--focus); font-weight: 600; text-decoration: none; }
::highlight(prompt-selection) { background: color-mix(in srgb, var(--focus) 35%, transparent); }
#prompt-box { position: absolute; z-index: 15; padding: 10px; border: 1px solid var(--focus); border-radius: 8px;
  background: var(--bg); box-shadow: 0 6px 24px rgb(0 0 0 / .3); font-size: 13px; }
#prompt-quote { margin-bottom: 8px; padding-left: 8px; border-left: 3px solid var(--border); color: var(--muted);
  white-space: pre-wrap; max-height: 4.5em; overflow: hidden; }
#prompt-input { display: block; width: 100%; padding: 6px 8px; resize: vertical; border: 1px solid var(--border);
  border-radius: 6px; background: var(--code-bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; }
#prompt-input:focus { outline: 2px solid var(--focus); outline-offset: -1px; }
#prompt-hint { color: var(--muted); font-size: 12px; }
#prompt-box .prompt-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 6px; }
#prompt-quote-toggle { color: var(--muted); font-size: 12px; white-space: nowrap; }
#prompt-box.no-quote #prompt-quote { opacity: .35; text-decoration: line-through; }
#context-menu { position: fixed; z-index: 20; min-width: 160px; padding: 4px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--bg); box-shadow: 0 4px 16px rgb(0 0 0 / .25); font-size: 13px; }
#context-menu button { display: block; width: 100%; padding: 6px 10px; border: 0; border-radius: 5px; background: none;
  color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
#context-menu button:hover:not(:disabled), #context-menu button:focus-visible { background: var(--code-bg); outline: none; }
#context-menu button:disabled { opacity: .4; cursor: default; }
#context-menu .check { display: inline-block; width: 1.3em; color: var(--focus); }
#context-menu hr { margin: 4px 6px; border: 0; border-top: 1px solid var(--border); }
header .status { width: 8px; height: 8px; border-radius: 50%; background: var(--del-bar); }
header .status.live { background: var(--add-bar); }
#error { display: none; padding: 10px 24px; background: var(--del-bg); color: var(--del-fg); font-family: ui-monospace, monospace; }
#error.visible { display: block; }
main { max-width: 900px; margin: 0 auto; padding: 24px; }
main h1, main h2 { border-bottom: 1px solid var(--border); padding-bottom: .3em; }
main a { color: var(--focus); }
main code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 85%;
  background: var(--code-bg); padding: .2em .4em; border-radius: 6px; }
main pre { background: var(--code-bg); padding: 16px; border-radius: 6px; overflow-x: auto; }
main pre code { padding: 0; background: none; }
main table { border-collapse: collapse; display: block; overflow-x: auto; }
main th, main td { border: 1px solid var(--border); padding: 6px 13px; }
main blockquote { margin: 0; padding: 0 1em; color: var(--muted); border-left: .25em solid var(--border); }
main img { max-width: 100%; }
.change { position: relative; margin-left: -16px; padding-left: 12px; border-left: 4px solid transparent; border-radius: 2px; }
.change-added { border-left-color: var(--add-bar); background: var(--add-bg); }
.change-removed { border-left-color: var(--del-bar); background: var(--del-bg); opacity: .75; }
.change-removed > * { text-decoration: line-through; text-decoration-color: var(--del-bar); }
.change-modified { border-left-color: var(--mod-bar); }
.change.focused { outline: 2px solid var(--focus); outline-offset: 2px; }
main * { scroll-margin-top: 100px; }
.edit-flash { position: absolute; pointer-events: none; border-radius: 3px;
  background: color-mix(in srgb, var(--focus) 30%, transparent); outline: 2px solid var(--focus); }
.edit-arrow { position: absolute; z-index: 5; width: 36px; height: 36px; margin-top: -18px; pointer-events: none;
  color: var(--focus); }
.edit-flash, .edit-arrow { transition: opacity 600ms ease-out; }
.edit-flash.fading, .edit-arrow.fading { opacity: 0; }
.edit-arrow svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 1px 2px rgb(0 0 0 / .3)); }
ins { background: var(--add-bg); color: var(--add-fg); text-decoration: none; border-radius: 2px; }
del { background: var(--del-bg); color: var(--del-fg); text-decoration: line-through; border-radius: 2px; }
body.hide-removed .change-removed, body.hide-removed del { display: none; }
body.plain .change { border-left-color: transparent; background: none; }
body.plain ins { background: none; color: inherit; }
body.plain del, body.plain .change-removed { display: none; }
body.edit-on-click main [data-src] { cursor: pointer; }
`;

const SCRIPT = `
const content = document.getElementById('content');
const errorBox = document.getElementById('error');
const statusDot = document.getElementById('status');
const statsBox = document.getElementById('stats');
const baseLabel = document.getElementById('base');
const followBox = document.getElementById('follow');
const editToggle = document.getElementById('edit-toggle');
const editBox = document.getElementById('edit-on-click');
const EDIT_ON_CLICK_KEY = 'mdlive.editOnClick';
const historyBox = document.getElementById('history');
const olderButton = document.getElementById('older');
const newerButton = document.getElementById('newer');
const historyCount = document.getElementById('history-count');
const resetBaseButton = document.getElementById('reset-base');
const commitButton = document.getElementById('commit');
let current = null;
let baseIndex = -1;
let mermaid = null;
let focusIndex = -1;
let previousText = null;
let lastEdit = null;
const mermaidCache = new Map();
const EXCLUDED_TEXT = 'del, .change-removed, .mermaid, code.language-mermaid';

import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs')
  .then((module) => {
    mermaid = module.default;
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' });
    renderMermaid();
  })
  .catch(() => {});

const renderMermaid = () => {
  if (!mermaid) {
    return;
  }
  const pending = [];
  for (const code of content.querySelectorAll('pre > code.language-mermaid')) {
    if (code.closest('.change-modified') || code.querySelector('ins, del')) {
      continue;
    }
    const source = code.textContent;
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.dataset.source = source;
    // Reuse the SVG of an unchanged diagram so the layout does not move while the new one renders.
    const cached = mermaidCache.get(source);
    if (cached) {
      div.innerHTML = cached;
      div.setAttribute('data-processed', 'true');
    } else {
      div.textContent = source;
      pending.push(div);
    }
    code.parentElement.replaceWith(div);
  }
  if (pending.length > 0) {
    mermaid.run({ nodes: pending }).catch(() => {}).finally(() => {
      for (const div of pending) {
        if (div.querySelector('svg')) {
          mermaidCache.set(div.dataset.source, div.innerHTML);
        }
      }
      revealLastEdit();
    });
  }
};

const renderStats = (stats) => {
  statsBox.innerHTML =
    '<span class="s-added">+' + stats.added + ' added</span>' +
    '<span class="s-removed">−' + stats.removed + ' removed</span>' +
    '<span class="s-modified">~' + stats.modified + ' modified</span>';
};

const changes = () => [...content.querySelectorAll('.change')].filter((node) => node.offsetParent !== null);

const focusChange = (step) => {
  const list = changes();
  if (list.length === 0) {
    return;
  }
  focusIndex = (focusIndex + step + list.length) % list.length;
  content.querySelectorAll('.change.focused').forEach((node) => node.classList.remove('focused'));
  list[focusIndex].classList.add('focused');
  list[focusIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
};

/** Returns the text nodes of the new document version: removed text and diagrams are excluded. */
const documentTextNodes = (root, nodes = []) => {
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      nodes.push(child);
    } else if (child.nodeType === Node.ELEMENT_NODE && !child.matches(EXCLUDED_TEXT)) {
      documentTextNodes(child, nodes);
    }
  }
  return nodes;
};

/** Returns the [start, end) offsets of the edited region in newText, or null if the texts are equal. */
const findEdit = (oldText, newText) => {
  if (oldText === newText) {
    return null;
  }
  const max = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < max && oldText[start] === newText[start]) {
    start += 1;
  }
  let suffix = 0;
  while (suffix < max - start && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) {
    suffix += 1;
  }
  return { start, end: newText.length - suffix };
};

const pointAt = (nodes, offset, preferNext) => {
  let position = 0;
  for (const node of nodes) {
    const length = node.data.length;
    if (offset < position + length || (!preferNext && offset === position + length)) {
      return { node, offset: offset - position };
    }
    position += length;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.data.length } : null;
};

const createEditRange = (nodes, edit) => {
  const start = pointAt(nodes, edit.start, true);
  if (!start) {
    return null;
  }
  const end = edit.end > edit.start ? pointAt(nodes, edit.end, false) : start;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
};

const rangeRects = (range) => {
  const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
  if (rects.length > 0) {
    return rects;
  }
  const container = range.startContainer;
  const element = container.nodeType === 1 ? container : container.parentElement;
  return [element.getBoundingClientRect()];
};

const centerRange = (range, behavior) => {
  const rects = rangeRects(range);
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const headerHeight = document.querySelector('header').offsetHeight;
  const visibleHeight = window.innerHeight - headerHeight;
  const anchor = bottom - top > visibleHeight / 2 ? top + visibleHeight / 4 : (top + bottom) / 2;
  window.scrollTo({ top: window.scrollY + anchor - (headerHeight + visibleHeight / 2), behavior });
};

const ARROW_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M3 10h11V5l8 7-8 7v-5H3z"/></svg>';
const ARROW_SIZE = 36;

const pointArrowAt = (rect) => {
  const arrow = document.createElement('div');
  arrow.className = 'edit-arrow';
  arrow.innerHTML = ARROW_SVG;
  const contentLeft = content.getBoundingClientRect().left;
  const left = Math.max(Math.min(contentLeft, rect.left) - ARROW_SIZE - 8, 4);
  arrow.style.left = left + window.scrollX + 'px';
  arrow.style.top = rect.top + rect.height / 2 + window.scrollY + 'px';
  document.body.appendChild(arrow);
};

const EDIT_HOLD_MS = 1500;
const EDIT_FADE_MS = 600;
let editFadeTimer = null;

const clearEditMarks = () => {
  document.querySelectorAll('.edit-flash, .edit-arrow').forEach((node) => node.remove());
};

const cancelEditFade = () => {
  clearTimeout(editFadeTimer);
  editFadeTimer = null;
};

const fadeEditMarks = () => {
  editFadeTimer = null;
  lastEdit = null;
  const marks = [...document.querySelectorAll('.edit-flash, .edit-arrow')];
  marks.forEach((node) => node.classList.add('fading'));
  setTimeout(() => marks.forEach((node) => node.remove()), EDIT_FADE_MS);
};

const startEditFade = () => {
  cancelEditFade();
  if (lastEdit) {
    editFadeTimer = setTimeout(fadeEditMarks, EDIT_HOLD_MS);
  }
};

// The highlight is there to be seen, so it only starts fading once the window has focus.
const fadeEditWhenSeen = () => {
  if (document.hasFocus() && document.visibilityState === 'visible') {
    startEditFade();
  }
};

const flashRange = (range) => {
  clearEditMarks();
  const rects = rangeRects(range);
  pointArrowAt(rects[0]);
  for (const rect of rects.slice(0, 50)) {
    const mark = document.createElement('div');
    mark.className = 'edit-flash';
    mark.style.top = rect.top + window.scrollY + 'px';
    mark.style.left = rect.left + window.scrollX + 'px';
    mark.style.width = Math.max(rect.width, 3) + 'px';
    mark.style.height = rect.height + 'px';
    document.body.appendChild(mark);
  }
};

const revealLastEdit = () => {
  if (!lastEdit || !followBox.checked || !lastEdit.startContainer.isConnected) {
    return;
  }
  centerRange(lastEdit, 'auto');
  flashRange(lastEdit);
};

const trackEdit = () => {
  const nodes = documentTextNodes(content);
  const text = nodes.map((node) => node.data).join('');
  const edit = previousText === null ? null : findEdit(previousText, text);
  previousText = text;
  lastEdit = null;
  cancelEditFade();
  clearEditMarks();
  if (!edit || !followBox.checked) {
    return;
  }
  lastEdit = createEditRange(nodes, edit);
  if (!lastEdit) {
    return;
  }
  centerRange(lastEdit, 'smooth');
  flashRange(lastEdit);
  fadeEditWhenSeen();
  for (const image of content.querySelectorAll('img')) {
    if (!image.complete) {
      image.addEventListener('load', revealLastEdit, { once: true });
    }
  }
};

const connect = () => {
  const source = new EventSource('/events');
  source.onopen = () => statusDot.classList.add('live');
  source.onerror = () => statusDot.classList.remove('live');
  source.onmessage = (event) => {
    receiveSnapshot(JSON.parse(event.data));
  };
};

const NO_GIT_REASON = 'Needs the file to be in a git repository';

// An unavailable control stays visible but greyed out, and its tooltip tells why.
const setUnavailable = (element, reason) => {
  element.dataset.title ??= element.title;
  element.disabled = reason !== null;
  element.title = reason ?? element.dataset.title;
};

const renderGitless = (snapshot) => {
  const reason = snapshot.inGit ? null : NO_GIT_REASON;
  const reviewLabel = document.getElementById('review-label');
  reviewLabel.hidden = !snapshot.canReview && snapshot.inGit;
  setUnavailable(reviewLabel, reason);
  for (const id of ['hide-removed', 'plain']) {
    setUnavailable(document.querySelector('[data-toggle="' + id + '"]'), reason);
  }
  setUnavailable(document.getElementById('prev'), reason);
  setUnavailable(document.getElementById('next'), reason);
};

const applySnapshot = (snapshot) => {
  // Switching between the local file and the pull request head is not an edit to highlight.
  if (current && current.reviewHead?.commit !== snapshot.reviewHead?.commit) {
    previousText = null;
  }
  errorBox.textContent = snapshot.error ?? '';
  errorBox.classList.toggle('visible', Boolean(snapshot.error));
  if (snapshot.html !== null) {
    content.innerHTML = snapshot.html;
    renderMermaid();
    prepareEditable();
    renderStats(snapshot.stats);
    trackEdit();
    focusIndex = -1;
  }
  current = snapshot;
  editToggle.hidden = !snapshot.canOpen;
  document.getElementById('prompt-label').hidden = !snapshot.canPrompt;
  document.getElementById('edit-label').hidden = !snapshot.canEdit;
  renderGitless(snapshot);
  renderCommit();
  followReviewHead(snapshot);
  layoutReview();
  applyEditOnClick();
  renderBase();
};

let committing = false;

// Edits that are not saved yet count as changes, because the commit saves them first.
const commitUnavailableReason = () => {
  if (!current?.inGit) {
    return NO_GIT_REASON + ' to commit';
  }
  if (current.reviewHead !== null) {
    return 'Leave the Review mode to commit the local file';
  }
  if (committing) {
    return 'Committing…';
  }
  return current.canCommit || unsaved.length > 0 ? null : 'No uncommitted changes in this file';
};

const renderCommit = () => {
  commitButton.hidden = !current?.canEdit;
  setUnavailable(commitButton, commitUnavailableReason());
};

const commitChanges = async () => {
  if (commitUnavailableReason() !== null) {
    return;
  }
  committing = true;
  renderCommit();
  try {
    await saveEdits();
    if (unsaved.length > 0) {
      return;
    }
    const response = await fetch('/commit', { method: 'POST' });
    if (!response.ok) {
      showEditError(await response.text());
    }
  } finally {
    committing = false;
    renderCommit();
  }
};

commitButton.onclick = commitChanges;

const RELATIVE_UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const formatAge = (seconds) => {
  const elapsed = seconds - Date.now() / 1000;
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= size) {
      return relativeTime.format(Math.round(elapsed / size), unit);
    }
  }
  return 'just now';
};

// RFC 3339 in local time with its offset, for example 2026-11-20T21:24:05-08:00.
const formatAuthorDate = (seconds) => {
  const date = new Date(seconds * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const zone = (offset >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(offset) / 60)) + ':' + pad(Math.abs(offset) % 60);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) + zone +
    ' (' + formatAge(seconds) + ')';
};

// Only the commit title or the ref name shrinks, so the hash and the date stay visible.
const labelParts = (parts) => parts.filter(([text]) => text !== '').map(([text, shrink]) => {
  const span = document.createElement('span');
  span.className = shrink ? 'shrink' : 'keep';
  span.textContent = text;
  return span;
});

const commitParts = (entry) => [
  ['vs ' + (entry.forkPoint ? 'origin/HEAD · ' : '') + entry.commit.slice(0, 8) + ' · ', false],
  [entry.subject, true],
  [' · ' + formatAuthorDate(entry.date), false],
];

const renderBase = () => {
  const snapshot = current;
  if (!snapshot.inGit) {
    baseLabel.replaceChildren(...labelParts([['Not in a git repository · no diff', false]]));
    baseLabel.title = NO_GIT_REASON + ' to show a diff';
    resetBaseButton.hidden = true;
    historyBox.hidden = false;
    for (const button of [olderButton, newerButton]) {
      setUnavailable(button, NO_GIT_REASON + ' to change the diff base');
    }
    historyCount.textContent = '–';
    return;
  }
  setUnavailable(olderButton, null);
  setUnavailable(newerButton, null);
  if (snapshot.pinnedCommit !== null) {
    const entry = snapshot.history.find((item) => item.commit === snapshot.pinnedCommit);
    baseLabel.replaceChildren(...labelParts(entry ? commitParts(entry) : [['vs ' + snapshot.pinnedCommit.slice(0, 8), false]]));
  } else {
    baseLabel.replaceChildren(...labelParts([
      ['vs ', false],
      [snapshot.base, true],
      [' (' + snapshot.baseCommit.slice(0, 8) + ')' +
        (snapshot.baseDate === null ? '' : ' · ' + formatAuthorDate(snapshot.baseDate)) +
        (snapshot.baseMissing ? ' · new file' : ''), false],
    ]));
  }
  baseLabel.title = baseLabel.textContent;
  resetBaseButton.hidden = snapshot.pinnedCommit === null;
  resetBaseButton.textContent = 'Reset to ' + snapshot.base;
  historyBox.hidden = snapshot.history.length < 2;
  baseIndex = snapshot.history.findIndex((item) => item.commit === snapshot.historyCommit);
  olderButton.disabled = baseIndex === 0;
  newerButton.disabled = baseIndex === -1 || baseIndex === snapshot.history.length - 1;
  historyCount.textContent = (baseIndex === -1 ? '–' : baseIndex + 1) + '/' + snapshot.history.length;
};

const selectBase = async (commit) => {
  const response = await fetch('/base', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit }),
  });
  if (!response.ok) {
    errorBox.textContent = await response.text();
    errorBox.classList.add('visible');
  }
};

// When the base matches no step, the newest step is the closest one to step back to.
const stepBase = (offset) => {
  if (current === null || current.history.length < 2) {
    return;
  }
  const from = baseIndex === -1 ? current.history.length : baseIndex;
  const index = from + offset;
  if (index < 0 || index >= current.history.length) {
    return;
  }
  selectBase(current.history[index].commit);
};

olderButton.onclick = () => stepBase(-1);
newerButton.onclick = () => stepBase(1);
resetBaseButton.onclick = () => selectBase(null);

// The marks use page coordinates, so redraw them when the layout moves (resize, diagrams, images, toggles).
new ResizeObserver(() => {
  if (lastEdit && lastEdit.startContainer.isConnected && followBox.checked) {
    flashRange(lastEdit);
  }
}).observe(content);
followBox.addEventListener('change', () => {
  if (!followBox.checked) {
    cancelEditFade();
    clearEditMarks();
  }
});
window.addEventListener('focus', startEditFade);
window.addEventListener('blur', cancelEditFade);
document.addEventListener('visibilitychange', fadeEditWhenSeen);

document.getElementById('next').onclick = () => focusChange(1);
document.getElementById('prev').onclick = () => focusChange(-1);
document.getElementById('hide-removed').onchange = (event) => document.body.classList.toggle('hide-removed', event.target.checked);
document.getElementById('plain').onchange = (event) => document.body.classList.toggle('plain', event.target.checked);
document.addEventListener('keydown', (event) => {
  if (!contextMenu.hidden && event.key === 'Escape') {
    closeContextMenu();
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  if (event.key === 'n' || event.key === 'j') {
    focusChange(1);
  } else if (event.key === 'p' || event.key === 'k') {
    focusChange(-1);
  } else if (event.key === 'e' && current?.canOpen) {
    editBox.checked = !editBox.checked;
    saveEditOnClick();
    if (editBox.checked) {
      turnOffOtherModes(editBox);
    }
  } else if (event.key === 'i' && current?.canEdit) {
    event.preventDefault();
    setEditMode(true);
  } else if (event.key === '[') {
    stepBase(-1);
  } else if (event.key === ']') {
    stepBase(1);
  }
});
const applyEditOnClick = () => {
  document.body.classList.toggle('edit-on-click', Boolean(current?.canOpen) && editBox.checked);
};

// Storage can be unavailable (private mode, blocked site data), so the toggle falls back to off.
const saveEditOnClick = () => {
  applyEditOnClick();
  renderToggles();
  try {
    localStorage.setItem(EDIT_ON_CLICK_KEY, editBox.checked ? '1' : '0');
  } catch {}
};

try {
  editBox.checked = localStorage.getItem(EDIT_ON_CLICK_KEY) === '1';
} catch {}
editBox.addEventListener('change', () => {
  saveEditOnClick();
  if (editBox.checked) {
    turnOffOtherModes(editBox);
  }
});

const caretAt = (x, y) => {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  const range = document.caretRangeFromPoint(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
};

// The server matches these texts in order against the block source to find the clicked character.
const clickTarget = (event) => {
  const block = event.target.closest('[data-src]');
  if (!block || !content.contains(block)) {
    return null;
  }
  const [start, end] = block.dataset.src.split('-').map(Number);
  const caret = caretAt(event.clientX, event.clientY);
  const clicked = caret && caret.node.nodeType === Node.TEXT_NODE && block.contains(caret.node) &&
    !caret.node.parentElement.closest(EXCLUDED_TEXT) ? caret.node : null;
  const texts = [];
  if (clicked) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && node !== clicked; node = walker.nextNode()) {
      if (node.data.trim() !== '' && !node.parentElement.closest(EXCLUDED_TEXT)) {
        texts.push(node.data);
      }
    }
    texts.push(clicked.data);
  }
  return { start, end, texts, offset: clicked ? caret.offset : 0 };
};

const openTarget = async (target) => {
  const response = await fetch('/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(target),
  });
  if (!response.ok) {
    errorBox.textContent = await response.text();
    errorBox.classList.add('visible');
  }
};

content.addEventListener('click', (event) => {
  if (!current?.canOpen || !editBox.checked || editModeBox.checked || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return;
  }
  if (event.target.closest('a, button, input, label, summary') || !window.getSelection().isCollapsed) {
    return;
  }
  const target = clickTarget(event);
  if (target) {
    openTarget(target);
  }
});

const contextMenu = document.getElementById('context-menu');
let menuTarget = null;
let menuCaret = null;

const closeContextMenu = () => {
  contextMenu.hidden = true;
  menuTarget = null;
  menuCaret = null;
};

const selectWordAt = (caret) => {
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) {
    return;
  }
  const text = caret.node.data;
  let start = caret.offset;
  let end = caret.offset;
  while (start > 0 && /[\\p{L}\\p{N}_'-]/u.test(text[start - 1])) {
    start -= 1;
  }
  while (end < text.length && /[\\p{L}\\p{N}_'-]/u.test(text[end])) {
    end += 1;
  }
  if (start < end) {
    const range = document.createRange();
    range.setStart(caret.node, start);
    range.setEnd(caret.node, end);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }
};

const pasteText = async () => {
  const text = window.mdliveReadClipboard ? await window.mdliveReadClipboard() : await navigator.clipboard.readText();
  content.focus({ preventScroll: true });
  document.execCommand('insertText', false, text);
};

const toggleItem = (label, box, show = true, unavailable = null) => ({
  label, show, checked: box.checked, run: () => box.click(), disabled: unavailable !== null, title: unavailable ?? '',
});

// Every control of the header has an item here, plus the actions on the clicked word.
// The caret and the target are captured now, because closing the menu clears them before an item runs.
const menuItems = () => {
  const caret = menuCaret;
  const target = menuTarget;
  const caretOffset = caret && current ? sourceOffsetAt(caret.node, caret.offset, current.source) : null;
  const hasSelection = !window.getSelection().isCollapsed;
  const inGit = current?.inGit !== false;
  const noGit = inGit ? null : NO_GIT_REASON;
  return [
    { label: 'Edit here', show: Boolean(current?.canEdit) && !editModeBox.checked && caretOffset !== null, run: () => setEditMode(true, caretOffset) },
    { label: 'Stop editing', show: editModeBox.checked, run: () => setEditMode(false) },
    { label: 'Paste', show: editModeBox.checked, run: pasteText },
    { label: 'Prompt about this…', show: Boolean(current?.canPrompt), run: () => {
      if (window.getSelection().isCollapsed) {
        selectWordAt(caret);
      }
      openPromptBox();
    } },
    { label: 'Review comment…', show: Boolean(current?.canReview), run: () => {
      if (!reviewModeBox.checked) {
        setReviewMode(true);
      }
      if (window.getSelection().isCollapsed) {
        selectWordAt(caret);
      }
      openPromptBox('review');
    } },
    { label: 'Open in Obsidian', show: Boolean(current?.canOpen && target), run: () => openTarget(target) },
    { label: 'Copy', show: hasSelection, run: () => document.execCommand('copy') },
    null,
    { label: 'Next change', disabled: !inGit, title: noGit, run: () => focusChange(1) },
    { label: 'Previous change', disabled: !inGit, title: noGit, run: () => focusChange(-1) },
    null,
    { label: 'Older diff base', show: !historyBox.hidden, disabled: olderButton.disabled, title: olderButton.disabled ? olderButton.title : '', run: () => olderButton.click() },
    { label: 'Newer diff base', show: !historyBox.hidden, disabled: newerButton.disabled, title: newerButton.disabled ? newerButton.title : '', run: () => newerButton.click() },
    { label: resetBaseButton.textContent, show: !resetBaseButton.hidden, run: () => resetBaseButton.click() },
    null,
    { label: 'Commit', show: !commitButton.hidden, disabled: commitButton.disabled, title: commitButton.disabled ? commitButton.title : '', run: commitChanges },
    null,
    toggleItem('Edit', editModeBox, Boolean(current?.canEdit)),
    toggleItem('Open in Obsidian on click', editBox, Boolean(current?.canOpen)),
    toggleItem('Follow', followBox),
    toggleItem('Hide removed', document.getElementById('hide-removed'), true, noGit),
    toggleItem('Plain', document.getElementById('plain'), true, noGit),
    toggleItem('Prompt', promptModeBox, Boolean(current?.canPrompt)),
    toggleItem('Review', reviewModeBox, Boolean(current?.canReview) || !inGit, noGit),
  ].filter((item) => item === null || item.show !== false);
};

const renderMenu = () => {
  contextMenu.replaceChildren();
  let pendingSeparator = false;
  for (const item of menuItems()) {
    if (item === null) {
      pendingSeparator = contextMenu.childElementCount > 0;
      continue;
    }
    if (pendingSeparator) {
      contextMenu.append(document.createElement('hr'));
      pendingSeparator = false;
    }
    const button = document.createElement('button');
    button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (item.checked !== undefined) {
      button.setAttribute('aria-checked', String(item.checked));
    }
    button.disabled = Boolean(item.disabled);
    button.title = item.title ?? '';
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = item.checked ? '✓' : '';
    button.append(check, item.label);
    button.onclick = () => {
      closeContextMenu();
      item.run();
    };
    contextMenu.append(button);
  }
};

// Links keep the native menu so that "Copy Link" stays available.
content.addEventListener('contextmenu', (event) => {
  if (event.target.closest('a')) {
    return;
  }
  event.preventDefault();
  menuTarget = clickTarget(event);
  const caret = caretAt(event.clientX, event.clientY);
  menuCaret = caret && content.contains(caret.node) ? caret : null;
  renderMenu();
  contextMenu.hidden = false;
  const width = contextMenu.offsetWidth;
  const height = contextMenu.offsetHeight;
  contextMenu.style.left = Math.min(event.clientX, window.innerWidth - width - 4) + 'px';
  contextMenu.style.top = Math.max(4, Math.min(event.clientY, window.innerHeight - height - 4)) + 'px';
  contextMenu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
});

document.addEventListener('pointerdown', (event) => {
  if (!contextMenu.hidden && !contextMenu.contains(event.target)) {
    closeContextMenu();
  }
});
window.addEventListener('blur', closeContextMenu);
window.addEventListener('scroll', closeContextMenu, { passive: true });

${EDITOR_SCRIPT}
${PROMPT_SCRIPT}
${REVIEW_SCRIPT}

// The header buttons show and change the hidden checkboxes, which hold the state the scripts use.
const toggleButtons = [...document.querySelectorAll('[data-toggle]')];
const renderToggles = () => {
  for (const button of toggleButtons) {
    button.setAttribute('aria-pressed', String(document.getElementById(button.dataset.toggle).checked));
  }
};
for (const button of toggleButtons) {
  button.addEventListener('click', () => document.getElementById(button.dataset.toggle).click());
}
document.querySelectorAll('header .state input').forEach((input) => input.addEventListener('change', renderToggles));
renderToggles();

connect();
`;

/**
 * Builds the HTML page that shows the live Markdown diff of `fileLabel`.
 */
export const renderPage = (fileLabel: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fileLabel)} · mdlive</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="title-row">
    <div id="status" class="status" title="Live connection"></div>
    <div id="history" class="history" hidden>
      <button id="older" title="Older diff base, back to the fork from origin/HEAD ([)">◀</button>
      <span id="history-count" class="count" title="Diff base: the fork from origin/HEAD, then each branch commit that changed this file"></span>
      <button id="newer" title="Newer diff base (])">▶</button>
      <button id="reset-base" hidden></button>
    </div>
    <div id="base" class="meta"></div>
  </div>
  <div id="stats" class="stats"></div>
  <div class="controls">
    <div class="mode" role="group" aria-label="Mode">
      <span class="mode-label">Mode</span>
      <span class="mode-buttons">
        <button id="edit-label" data-toggle="edit-mode" title="Edit the rendered text in place (i to start, Esc to stop)">Edit</button>
        <button id="edit-toggle" data-toggle="edit-on-click" hidden title="Click on text to open it in Obsidian at that position (e)">Open in Obsidian</button>
        <button id="prompt-label" data-toggle="prompt-mode" hidden title="Select text to ask the Claude Code pane that works on this file">Prompt</button>
        <button id="review-label" data-toggle="review-mode" hidden title="Review the pull request of the branch: select text to leave a draft review comment">Review</button>
      </span>
    </div>
    <button data-toggle="follow" title="Scroll to the text that changed on each update">Follow</button>
    <button data-toggle="hide-removed" title="Hide the removed text">Hide removed</button>
    <button data-toggle="plain" title="Show the document without the diff">Plain</button>
    <button id="prev" title="Previous change (p)">↑</button>
    <button id="next" title="Next change (n)">↓</button>
    <button id="commit" title="Save the edits and commit this file, and only this file, to git">Commit</button>
    <div class="state" hidden>
      <input type="checkbox" id="edit-mode">
      <input type="checkbox" id="edit-on-click">
      <input type="checkbox" id="prompt-mode">
      <input type="checkbox" id="review-mode">
      <input type="checkbox" id="follow" checked>
      <input type="checkbox" id="hide-removed">
      <input type="checkbox" id="plain">
    </div>
  </div>
  <div id="review-row" class="review-row" hidden>
    <a id="review-pr" target="_blank" rel="noreferrer"></a>
    <span id="review-drafts" class="meta"></span>
    <span id="review-head" class="meta"></span>
    <select id="review-event" title="How to publish the review">
      <option value="COMMENT">Comment</option>
      <option value="APPROVE">Approve</option>
      <option value="REQUEST_CHANGES">Request changes</option>
    </select>
    <input id="review-summary" placeholder="Review summary (optional)">
    <button id="review-publish" disabled>Publish review</button>
    <button id="review-discard" disabled>Discard drafts</button>
    <button id="review-refresh" title="Reload the review from GitHub">↻</button>
  </div>
</header>
<div id="error"></div>
<div id="prompt-box" hidden>
  <div id="prompt-quote"></div>
  <textarea id="prompt-input" rows="3" placeholder="Ask Claude about the selection…"></textarea>
  <div class="prompt-footer">
    <div id="prompt-hint">↩ send to Claude · ⇧↩ new line · Esc cancel</div>
    <label id="prompt-quote-toggle" hidden><input type="checkbox" id="prompt-quote-box" checked> Quote the selection</label>
  </div>
</div>
<div id="context-menu" role="menu" hidden></div>
<main id="content"></main>
<aside id="review-panel" hidden></aside>
<script type="module">${SCRIPT}</script>
</body>
</html>`;
