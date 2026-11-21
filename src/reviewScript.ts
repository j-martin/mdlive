/**
 * Page script for the Review mode: a header row with the pull request and the publish controls, and a side panel
 * with the review threads of the file next to the lines they are on. Selecting text opens the selection box of
 * the prompt script, which adds a draft review comment. It runs in the same scope as the other page scripts and
 * uses their `content`, `current`, `errorBox`, `blockAt`, `formatAge`, `renderToggles`, `closePromptBox` and
 * `turnOffOtherModes`.
 */
export const REVIEW_SCRIPT = `
const reviewModeBox = document.getElementById('review-mode');
const reviewPanel = document.getElementById('review-panel');
const reviewRow = document.getElementById('review-row');
const reviewPr = document.getElementById('review-pr');
const reviewDrafts = document.getElementById('review-drafts');
const reviewEvent = document.getElementById('review-event');
const reviewSummary = document.getElementById('review-summary');
const reviewPublish = document.getElementById('review-publish');
const reviewDiscard = document.getElementById('review-discard');
const REVIEW_REFRESH_MS = 60000;
const CONFIRM_MS = 4000;
const CARD_GAP = 8;
let review = null;
let reviewTimer = null;
let reviewStarting = false;
// While a comment is being edited, a refresh waits, so that it does not replace the text being typed.
let editingComment = null;
let deferredReview = null;

const showReviewError = (error) => {
  errorBox.textContent = String(error.message ?? error);
  errorBox.classList.add('visible');
};

const reviewRequest = async (path, body) => {
  const response = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
};

const loadReview = async () => {
  try {
    renderReview(await reviewRequest('/review'));
  } catch (error) {
    showReviewError(error);
  }
};

const lineOffset = (source, line) => {
  let offset = 0;
  for (let index = 1; index < line; index += 1) {
    const next = source.indexOf('\\n', offset);
    if (next === -1) {
      return source.length;
    }
    offset = next + 1;
  }
  return offset;
};

const threadBlock = (thread) => (thread.line === null || !current ? null : blockAt(lineOffset(current.source, thread.line)));

const pageTop = (element) => element.getBoundingClientRect().top + window.scrollY;

const commentBody = (body) => {
  const element = document.createElement('div');
  let paragraph = null;
  for (const line of body.split('\\n')) {
    if (line.trim() === '' && paragraph?.className !== 'text') {
      paragraph = null;
      continue;
    }
    const isQuote = line.startsWith('>');
    const kind = isQuote ? 'quote' : 'text';
    if (!paragraph || paragraph.className !== kind) {
      paragraph = document.createElement('div');
      paragraph.className = kind;
      element.append(paragraph);
    } else {
      paragraph.append('\\n');
    }
    paragraph.append(isQuote ? line.replace(/^>\\s?/, '') : line);
  }
  return element;
};

const deleteDraft = async (commentId) => {
  try {
    renderReview(await reviewRequest('/review/delete', { id: commentId }));
  } catch (error) {
    showReviewError(error);
  }
};

const finishCommentEdit = (data) => {
  editingComment = null;
  const latest = data ?? deferredReview;
  deferredReview = null;
  if (latest) {
    renderReview(latest);
  }
};

// The editor replaces the text of the comment in its card; the whole body is editable, quote included.
const editComment = (item, comment, shown) => {
  if (editingComment !== null) {
    return;
  }
  editingComment = comment.id;
  const editor = document.createElement('div');
  editor.className = 'comment-editor';
  const textarea = document.createElement('textarea');
  textarea.value = comment.body;
  textarea.rows = Math.min(Math.max(comment.body.split('\\n').length + 1, 3), 14);
  const save = document.createElement('button');
  save.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = '⌘↩ save · Esc cancel';
  const buttons = document.createElement('div');
  buttons.className = 'actions';
  buttons.append(save, cancel, hint);
  editor.append(textarea, buttons);
  const close = () => {
    editor.remove();
    shown.forEach((element) => {
      element.hidden = false;
    });
    finishCommentEdit(null);
    layoutReview();
  };
  const submit = async () => {
    if (textarea.value.trim() === '' || textarea.value === comment.body) {
      close();
      return;
    }
    save.disabled = true;
    textarea.disabled = true;
    try {
      finishCommentEdit(await reviewRequest('/review/edit', { id: comment.id, body: textarea.value }));
    } catch (error) {
      showReviewError(error);
      save.disabled = false;
      textarea.disabled = false;
      textarea.focus();
    }
  };
  save.addEventListener('click', submit);
  cancel.addEventListener('click', close);
  editor.addEventListener('click', (event) => event.stopPropagation());
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  });
  shown.forEach((element) => {
    element.hidden = true;
  });
  item.append(editor);
  layoutReview();
  textarea.focus();
};

const threadCard = (thread) => {
  const card = document.createElement('div');
  const pending = thread.comments.some((comment) => comment.pending);
  card.className = 'thread' + (pending ? ' draft' : '') + (thread.resolved ? ' resolved' : '') + (thread.outdated ? ' outdated' : '');
  const where = document.createElement('div');
  where.className = 'where';
  where.textContent = (thread.line === null ? 'File' : 'Line ' + (thread.startLine && thread.startLine < thread.line ? thread.startLine + '-' : '') + thread.line) +
    (thread.outdated ? ' · outdated' : '') + (thread.resolved ? ' · resolved' : '');
  card.append(where);
  for (const comment of thread.comments) {
    const item = document.createElement('div');
    item.className = 'comment';
    const meta = document.createElement('div');
    meta.className = 'meta-line';
    const author = document.createElement('span');
    author.className = 'author';
    author.textContent = comment.author;
    meta.append(author, ' · ' + formatAge(Date.parse(comment.createdAt) / 1000));
    if (comment.pending) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Draft';
      meta.append(badge);
    }
    const body = commentBody(comment.body);
    const actions = document.createElement('div');
    actions.className = 'actions';
    if (comment.canEdit) {
      const edit = document.createElement('button');
      edit.textContent = 'Edit';
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        editComment(item, comment, [body, actions]);
      });
      actions.append(edit);
    }
    if (comment.pending) {
      const remove = document.createElement('button');
      remove.textContent = 'Delete draft';
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        remove.disabled = true;
        deleteDraft(comment.id);
      });
      actions.append(remove);
    }
    item.append(meta, body, actions);
    card.append(item);
  }
  card.addEventListener('click', () => {
    const block = threadBlock(thread);
    if (block) {
      block.scrollIntoView({ block: 'center', behavior: 'smooth' });
      block.classList.add('review-target');
      setTimeout(() => block.classList.remove('review-target'), 1500);
    }
  });
  return card;
};

// Each card goes next to the block of its line; a card that would overlap the one above it moves down.
const layoutReview = () => {
  if (!review || reviewPanel.hidden) {
    return;
  }
  const contentTop = pageTop(content);
  const placed = [...reviewPanel.children].map((card, index) => {
    const block = threadBlock(review.threads[index]);
    return { card, top: block ? pageTop(block) : contentTop };
  }).sort((a, b) => a.top - b.top);
  let bottom = contentTop;
  for (const { card, top } of placed) {
    const at = Math.max(top, bottom);
    card.style.top = at + 'px';
    bottom = at + card.offsetHeight + CARD_GAP;
  }
};

const renderReview = (data) => {
  if (editingComment !== null) {
    deferredReview = data;
    return;
  }
  review = data;
  const pullRequest = data.pullRequest;
  if (pullRequest) {
    reviewPr.textContent = 'PR #' + pullRequest.number + ' · ' + pullRequest.title;
    reviewPr.href = pullRequest.url;
  } else {
    reviewPr.textContent = 'This branch has no open pull request';
    reviewPr.removeAttribute('href');
  }
  reviewDrafts.textContent = data.publishedUrl
    ? 'Review published'
    : data.draftCount === 1 ? '1 draft comment' : data.draftCount + ' draft comments';
  reviewPublish.disabled = data.draftCount === 0;
  reviewDiscard.disabled = data.draftCount === 0;
  reviewPanel.replaceChildren(...data.threads.map(threadCard));
  layoutReview();
};

// The server shows the file at the head of the pull request while reviewing. \`remote\` is false when the page only
// follows a change that the server already made, for example from another window.
const setReviewMode = async (enabled, remote = true) => {
  // A pull request opened by its link has no local file to go back to.
  if (!enabled && current?.reviewOnly) {
    reviewModeBox.checked = true;
    renderToggles();
    return;
  }
  if (enabled) {
    turnOffOtherModes(reviewModeBox);
  }
  reviewModeBox.checked = enabled;
  renderToggles();
  document.body.classList.toggle('reviewing', enabled);
  reviewPanel.hidden = !enabled;
  reviewRow.hidden = !enabled;
  clearInterval(reviewTimer);
  if (!enabled) {
    if (!promptBox.hidden && selectionMode === 'review') {
      closePromptBox();
    }
    if (remote) {
      await fetch('/review/stop', { method: 'POST' });
    }
    return;
  }
  reviewTimer = setInterval(loadReview, REVIEW_REFRESH_MS);
  if (!remote) {
    loadReview();
    return;
  }
  reviewStarting = true;
  try {
    renderReview(await reviewRequest('/review/start', {}));
  } catch (error) {
    showReviewError(error);
    setReviewMode(false);
  } finally {
    reviewStarting = false;
  }
};

const followReviewHead = (snapshot) => {
  const head = snapshot.reviewHead;
  document.getElementById('review-head').textContent = head
    ? 'Showing ' + (head.branch ? 'origin/' + head.branch : 'the pull request head') + ' @ ' + head.commit.slice(0, 8)
    : '';
  if (head && !reviewModeBox.checked) {
    setReviewMode(true, false);
  } else if (!head && reviewModeBox.checked && !reviewStarting) {
    setReviewMode(false, false);
  }
};

// Publishing and discarding cannot be undone, and the page cannot show a confirm dialog, so they take two clicks.
const confirmAction = (button, action) => {
  const label = button.textContent;
  let timer = null;
  button.addEventListener('click', async () => {
    if (!button.dataset.armed) {
      button.dataset.armed = 'true';
      button.textContent = 'Click again to confirm';
      timer = setTimeout(() => {
        delete button.dataset.armed;
        button.textContent = label;
      }, CONFIRM_MS);
      return;
    }
    clearTimeout(timer);
    delete button.dataset.armed;
    button.textContent = label;
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      showReviewError(error);
      button.disabled = false;
    }
  });
};

confirmAction(reviewPublish, async () => {
  renderReview(await reviewRequest('/review/submit', { event: reviewEvent.value, body: reviewSummary.value }));
  reviewSummary.value = '';
});
confirmAction(reviewDiscard, async () => renderReview(await reviewRequest('/review/discard', {})));
document.getElementById('review-refresh').addEventListener('click', loadReview);
reviewModeBox.addEventListener('change', () => setReviewMode(reviewModeBox.checked));
new ResizeObserver(layoutReview).observe(content);
`;
