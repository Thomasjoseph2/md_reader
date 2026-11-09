# Markdown Folder Viewer

Read Markdown files, and whole folders of them, the way GitHub shows them. Open a folder of plans, specs or notes and
browse it like a small website: a file tree, working links between files, search, diagrams, and PDF export.

Files never leave your computer. Nothing is uploaded and nothing is tracked.

## What it opens

- **One `.md` file**, several files, or a whole folder (picked, or dragged onto the page)
- **Any folder layout**: nested folders, `README.md` / `index.md` in each folder, docs sites, Obsidian vaults
- **Links between files**: `[text](other.md)`, `../`, `#heading`, links to folders, and Obsidian `[[wiki links]]`
- **GitHub-style Markdown**: tables, task lists, code highlighting, `> [!NOTE]` callouts, images in the folder,
  Mermaid diagrams, front matter
- Skips `node_modules`, `.git` and similar folders

## Review comments

Team leads and PMs can review a set of docs and send their comments back as one file.

1. Select text and click **Comment**, or use **+ Add comment** for a whole file, a folder or the whole project.
   Types: comment, question, change request (with suggested text), looks good.
2. **Download review** saves `review-<folder>-<name>-<date>.md`: a readable report, plus the exact data (file,
   section, line numbers, quoted text, suggested text, author, time, file version) in a JSON block at the end,
   ready for an AI agent to apply.
3. The owner opens the same folder, clicks **Open review files** (several at once is fine) and sees every comment in
   place. Reviews made on a sub-folder or a parent folder still line up.

Comments are kept in the browser until downloaded, and the viewer warns before leaving with comments not downloaded.

## Features

- Folder tree, breadcrumbs, previous / next, an "On this page" contents list
- Search across every file (press `/`), with matches highlighted
- **PDF**: the current page, or the whole folder as one PDF with a contents page
- Dark mode, phone layout
- Chrome / Edge: **Reload** re-reads the folder after you edit files, and the last folder can be reopened

## Use it

**As a Chrome extension.** Click the toolbar icon to open the viewer. With "Allow access to file URLs" turned on, any
`.md` file you open in Chrome (drag it into a tab, or open it from your file manager) shows formatted too.

**As a web page.** Open `index.html` in any browser. No install and no server needed.

**Try it** on the sample folder in [`demo/project-plan`](demo/project-plan).

## Install the extension from this folder (for testing)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `app` folder.
3. Click the extension's **Details** and turn on **Allow access to file URLs** to open `.md` files straight from disk.

## Project layout

| Path | What it is |
| --- | --- |
| `app/` | The extension and the web app (the same files) |
| `app/index.html`, `viewer.js` | The folder viewer |
| `app/page.js` | Shows a single `.md` file opened from disk (extension only) |
| `app/core.js` | Markdown rendering shared by both |
| `app/lib/` | Bundled libraries: marked, DOMPurify, highlight.js, Mermaid (licences in `app/THIRD_PARTY_LICENSES.txt`) |
| `store/` | Chrome Web Store screenshots, promo tile and listing text |
| `build.sh` | Makes the zip to upload to the Chrome Web Store |
| `PUBLISHING.md` | Step-by-step guide to publishing |
| `PRIVACY.md` | Privacy policy |

The libraries are bundled rather than loaded from the internet because the Chrome Web Store does not allow remote code.
`lib/mermaid.min.js` has one change: a raw U+FFFF character is written as `￿`, because Chrome refuses to load
extension files that contain it.
