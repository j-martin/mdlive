# mdlive

`mdlive` renders a Markdown file in a native window. The page updates live when the file changes. The page shows the git diff inline with the rendered content. This is all LLM generated, and buggy.

## Install

1. Go to `tools/mdlive`.
2. Run `bun install`.

## Build a binary

1. Run `bun run build`.
2. Use the binary at `dist/mdlive`. The binary includes the Bun runtime, so the target machine does not need Bun.

To build the binary and install it in `~/.local/bin`, run `bun run install-bin`. To use a different folder, set `INSTALL_DIR`. Example: `INSTALL_DIR=/usr/local/bin bun run install-bin`.

## Use

```sh
# in repo
bun ./index.ts README.md --base master

# system
bun run install-bin
mdlive <file>.md
```

To review a pull request without a local checkout, pass its link instead of a file:

```sh
mdlive https://github.com/<full-repo-name>/pull/121
```

`mdlive` shows a Markdown file of the pull request at its head, compared with the commit where the pull request branched from its base, like GitHub. It picks the file from `--file <path>`, else from a `#diff-...` anchor of a link copied from the **Files changed** tab, else the first Markdown file of the pull request. **Review** is the only mode: there is no local file to edit, prompt about or open in Obsidian. New pushes show up within a minute.

Outside a git repository, `mdlive` still renders the file live and keeps Edit, Prompt and Open in Obsidian. It shows no diff, so the diff base steps, **Hide removed**, **Plain**, the change navigation and **Review** are greyed out, and their tooltip says why.

Options:

- `--file <path>`: with a pull request link, the file of the pull request to show.
- `--base <ref>`: the git ref to compare with. The default is `HEAD`.
- `--port <number>`: the HTTP port. The default is a random free port.
- `--browser`: open the page in the default browser instead of a window.
- `--no-open`: do not open a window or a browser. Only start the server.

## Window

The window uses the system WebView through [`webview-bun`](https://github.com/tr1ckydev/webview-bun): WebKit on macOS, WebKitGTK 6 on Linux (install `libwebkitgtk-6.0-4`), and WebView2 on Windows. The window opens at the full height of the screen. On macOS, the app shows an `mdlive` icon in the Dock and the `Cmd+Tab` switcher. The name in the switcher is the name of the process: `mdlive` for the binary, `bun` when you run `bun index.ts`. The window has no menu bar, so the page handles these shortcuts:

- `Cmd+C` copies, `Cmd+X` cuts, `Cmd+V` pastes, `Cmd+Z` undoes, `Cmd+Shift+Z` redoes, `Cmd+A` selects all, `Cmd+R` reloads.
- `Cmd+W` or `Cmd+Q` quits `mdlive`.
- A link to another site opens in the default browser.

## Page

- A green block is an added block.
- A red block with a line through the text is a removed block.
- A block with a yellow bar is a modified block. `<ins>` shows the added words and `<del>` shows the removed words.
- **◀** and **▶** change the diff base. The oldest step is the commit where the branch forked from `origin/HEAD`. The next steps are the branch commits that changed the file. Without `origin/HEAD`, the steps cover the whole history of the file. Press `[` or `]` to step. **Reset to `<base>`** follows the `--base` ref again. The choice applies to every open window or tab.
- **Hide removed** hides the removed text.
- **Plain** shows the document without the diff.
- The **Mode** buttons choose what a click or a selection does: **Edit**, **Open in Obsidian**, **Prompt** or **Review**. Only one mode is on at a time; click the active mode again to turn it off. **Follow**, **Hide removed** and **Plain** are toggle buttons.
- Right-click on the page for a menu with every control of the header, plus **Edit here** (start editing with the cursor on the clicked word), **Prompt about this…** (ask Claude about the selection or the clicked word), **Open in Obsidian** and **Copy**. Right-click on a link for the browser menu.
- Press `n` or `j` to go to the next change. Press `p` or `k` to go to the previous change.
- The page renders `mermaid` code blocks that did not change.
- Choose the **Edit** mode (or press `i`) to edit the rendered text in place, and press `Escape` (or click **Edit** again) to stop. The cursor starts in the first text on screen, so the page does not scroll. Changes are saved to the Markdown file when the page loses focus, after 10 seconds without edits, when you stop editing, and before the window closes:
  - Typing, deleting and pasting change the source text under the cursor, so formatting stays as it is.
  - `Enter` starts a new paragraph, or a new item in a list. In a code block it starts a new line.
  - `Cmd+B` and `Cmd+I` make the selection bold or italic. `Cmd+Z` and `Cmd+Shift+Z` undo and redo.
  - Removed text, diagrams and images cannot be edited. A character typed as Markdown syntax (for example `*`) goes to the file as is.
  - If the file changes in another editor while you have unsaved edits, `mdlive` saves your edits first. Each edit is found again by the text around it, so both changes are kept. If an edit cannot be placed, the page shows an error and keeps your text on the page.
- Choose the **Prompt** mode to ask Claude about the text you select. A box opens under the selection. Type the prompt and press `Enter` (`Shift+Enter` for a new line, `Escape` to cancel). `mdlive` sends the file path, the line numbers, the selected Markdown and your prompt to a Claude Code pane with `hc send`, then shows that pane in Herdr (`herdr-app do pane.focus`) and brings Herdr to the front. The pane is one whose `claude` process works in a directory that contains the file: the deepest directory first, then the most recently active pane. If there is none, `mdlive` starts `claude --model claude-opus-5-5` at the root of the repository, with the prompt as its first message, in a new Herdr tab (`herdr-app do tab.new`) of the space where you work on that repository. Without `herdr-app`, the pane starts with `hc run` and carries the Herdr labels. The **Prompt** mode only shows when `hc` is on the `PATH`.
- Choose the **Review** mode to review the pull request of the branch (it needs `gh`). While you review, the page shows the file as it is at the head of the pull request on `origin` (`mdlive` fetches `pull/<number>/head`), not your local copy, so the lines match GitHub. The row says which commit you see; new pushes show up within a minute. Leaving the mode shows your local file again. The row under the header shows the pull request, and a panel on the right shows the review threads of the file next to their lines. Select text, type your feedback in the box and press `Enter`: `mdlive` adds a draft review comment that quotes the selection. Untick **Quote the selection** in the box to leave only your feedback; the box remembers the choice. Drafts are comments of your pending review on GitHub: only you see them until you publish. Comments go on the lines of the pull request head; when the selection is not on lines that the pull request changes, the comment goes on the whole file. Click **Edit** on one of your comments (a draft or a published one) to change its text, quote included, then press `Cmd+Enter` or click **Save** (`Escape` cancels). Delete a draft from its card. To finish, choose **Comment**, **Approve** or **Request changes**, add an optional summary and click **Publish review** twice. **Discard drafts** deletes the pending review.
- If the file is in an Obsidian vault, choose the **Open in Obsidian** mode (or press `e`) to open the file in Obsidian when you click on text, or right-click on text and choose **Open in Obsidian**. The cursor goes to the clicked character. The page remembers the setting. Clicks on links, clicks with a modifier key, and clicks that end a text selection do not open Obsidian. Obsidian must be running, and the `obsidian` command line tool must be on the `PATH`. A click on removed text or on a diagram opens the closest position that `mdlive` can find.

## How it works

1. The tool splits the old and the new Markdown into blocks with `marked`.
2. The tool compares the blocks with `diff`.
3. For each changed group of blocks, the tool compares the rendered HTML word by word. The output keeps the HTML tags of the new version.
4. If the old and the new text are too different, the tool shows the old block as removed and the new block as added.
5. The server sends the result to the page with Server-Sent Events (SSE).
6. Each rendered block has a `data-src` attribute with its range in the source. On a click, the page sends the texts of the block up to the clicked character. The server finds these texts in order in the block source to get the line and the column, then runs `obsidian eval` to open the file and move the cursor.
7. In edit mode, the page cancels each `beforeinput` event and turns it into a patch of the source: a range, the new text, and the text around the range. The page finds the range with the same text matching as the click (step 6), sends the patches in order to `POST /patch`, and shows a change inside one text at once. The server applies a patch only if the text around the range is still the same. Other changes wait for the new render, then the page puts the cursor back at the same source offset.
8. In window mode, the server, the file watcher and the base polling run in a `Worker`, because the window's event loop blocks the main thread.
9. The tool watches the file for changes. The tool also checks the base ref every 2 seconds, so a new commit updates the diff.

## Test

```sh
bun test
```
