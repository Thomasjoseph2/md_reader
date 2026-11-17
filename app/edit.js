/* Edit and rename Markdown files.
   - Folder opened with the browser's folder picker (Chrome, Edge): Edit asks permission once, then saves to the REAL file.
   - Anything else (other browsers, dropped or uploaded files): Edit changes the copy in this tab and Save downloads the file. */
(() => {
  const $ = (s) => document.querySelector(s);
  const canWriteDisk = () => !!(state.dirHandle && typeof state.dirHandle.requestPermission === 'function');
  let editing = null;                        // { path, real, original, draft, stale, source, open }

  const editor = document.createElement('section');
  editor.id = 'editor'; editor.className = 'editor hidden';
  editor.innerHTML = `
    <p class="edit-banner" id="edBanner"></p>
    <div class="edit-bar"><button class="btn primary" id="edSave">Save</button><button class="btn" id="edCancel">Cancel</button>
      <button class="btn" id="edAdd" title="Add a new paragraph at the end">+ Add text</button>
      <button class="btn" id="edMode" title="See and edit the whole file as plain Markdown">Edit as raw Markdown</button><span id="edStatus"></span></div>
    <p class="edit-hint" id="edHint">Click any paragraph, heading, list, table or code block and change it right on the page. Clear a block to delete it.</p>
    <textarea id="edText" class="hidden" spellcheck="false" aria-label="Edit Markdown"></textarea>`;
  $('#doc').before(editor);
  const rename = document.createElement('form');
  rename.id = 'renameRow'; rename.className = 'rename-row hidden';
  rename.innerHTML = `<input id="rnInput" maxlength="150" aria-label="New file name" autocomplete="off"><button class="btn primary" type="submit">Rename</button><button class="btn" type="button" id="rnCancel">Cancel</button><span id="rnErr" class="rn-err"></span>`;
  $('#docActions').after(rename);

  const q = { text: $('#edText'), banner: $('#edBanner'), status: $('#edStatus'), save: $('#edSave'), mode: $('#edMode'), hint: $('#edHint'), add: $('#edAdd') };
  const current = () => (editing.source ? q.text.value : editing.draft);
  const dirty = () => editing && current() !== editing.original;
  const sameFile = (a, b) => a && b && a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

  async function fileHandle(path, create) {                     // walk the opened folder down to the file
    const parts = path.split('/'); let dir = state.dirHandle;
    for (const d of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(d);
    return { dir, handle: await dir.getFileHandle(parts.at(-1), { create: !!create }) };
  }
  async function askWrite() {
    if (!canWriteDisk()) return false;
    try {
      const o = { mode: 'readwrite' };
      return (await state.dirHandle.queryPermission(o)) === 'granted' || (await state.dirHandle.requestPermission(o)) === 'granted';
    } catch { return false; }
  }
  const reloadAll = (keep) => load([...state.files].map(([path, file]) => ({ path, file })), state.root, keep);
  const setHash = (p) => { location.hash = hrefFor(p).replace(/^[^#]*/, ''); };

  /* ---------- edit: click a block on the page (the rest of the file is never touched) ---------- */
  async function startEdit() {
    if (editing || !state.current) return;
    const path = state.current, real = await askWrite();
    editing = { path, real, original: state.texts.get(path), draft: state.texts.get(path), stale: false, file: state.files.get(path), source: false, open: null };
    q.banner.className = 'edit-banner ' + (real ? 'real' : 'copy');
    q.banner.textContent = real
      ? `You are editing the real file on your computer: ${state.root}/${path}. Save writes to it.`
      : 'You are editing a copy in this tab. Save downloads the edited file; your original is not changed.';
    q.status.textContent = '';
    document.body.classList.add('editing');
    editor.classList.remove('hidden');
    showMode(!$('#doc > [data-line]'));                           // nothing clickable (e.g. a .txt file): go straight to the plain editor
  }
  function showMode(source) {
    editing.source = source;
    q.text.classList.toggle('hidden', !source); $('#doc').classList.toggle('hidden', source);
    q.hint.classList.toggle('hidden', source); q.add.classList.toggle('hidden', source);
    q.mode.textContent = source ? 'Back to the page' : 'Edit as raw Markdown';
    document.body.classList.toggle('editing-blocks', !source);
    if (source) { q.text.value = editing.draft; q.text.focus(); }
  }
  async function toggleSource() {
    if (!editing) return;
    await settle();
    if (editing.source) { editing.draft = q.text.value; await show(editing.draft); showMode(false); }
    else showMode(true);
  }
  async function show(text) {                                     // redraw the page from the draft (not saved yet)
    state.texts.set(editing.path, text);
    await render(editing.path, '', true);
  }
  function stopEdit() {
    editing = null;
    document.body.classList.remove('editing', 'editing-blocks');
    editor.classList.add('hidden'); q.text.classList.add('hidden'); $('#doc').classList.remove('hidden');
  }
  const settle = async () => { if (editing && editing.open) await editing.open.apply(); };

  const lineEnd = (draft) => (draft.includes('\r\n') ? '\r\n' : '\n');
  // Which block did the click land in? Tables sit inside a scroll wrapper, so the line info is on the table itself.
  const blockAt = (target) => {
    const data = target.closest('#doc [data-line]');
    if (!data) return null;
    let top = data;
    while (top.parentElement && top.parentElement.id !== 'doc') top = top.parentElement;
    return top.parentElement && top.parentElement.id === 'doc' ? { top, data } : null;
  };
  const VISUAL = new Set(['paragraph', 'heading', 'list', 'blockquote', 'table', 'code', 'hr']);
  let td = null;
  function toMarkdown(host) {
    if (!td) {
      td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', hr: '---', emDelimiter: '*', strongDelimiter: '**', br: '  ' });
      td.use(turndownPluginGfm.gfm);
      td.escape = (t) => t;                                      // keep the author's text as typed
      td.addRule('keepImageSource', { filter: 'img', replacement: (c, n) => `![${n.getAttribute('alt') || ''}](${n.dataset.src || n.getAttribute('src')}${n.title ? ` "${n.title}"` : ''})` });
    }
    const copy = host.cloneNode(true);
    copy.querySelectorAll('td br, th br').forEach((b) => b.remove());          // a line break inside a table cell would break the table
    return td.turndown(copy.innerHTML).replace(/\n{3,}/g, '\n\n').replace(/^(\s*(?:[-*+]|\d+\.))[ \t]{2,}(?=\S)/gm, '$1 ');
  }
  function toolbar(host, hasTable, hasCode) {
    const bar = document.createElement('div'); bar.className = 'blk-bar';
    const add = (label, title, fn, cls) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, title, className: cls || '' });
      b.onmousedown = (e) => { e.preventDefault(); host.focus(); fn(); };       // keep the selection inside the block
      bar.append(b);
    };
    const cmd = (c, v) => () => document.execCommand(c, false, v);
    if (!hasCode) {
      add('B', 'Bold', cmd('bold'), 'b'); add('I', 'Italic', cmd('italic'), 'i');
      add('</>', 'Inline code', () => { const t = getSelection().toString(); if (t) document.execCommand('insertHTML', false, `<code>${t.replace(/[<&]/g, (m) => (m === '<' ? '&lt;' : '&amp;'))}</code>`); });
      add('Link', 'Make a link', () => { const u = prompt('Link address'); if (u) document.execCommand('createLink', false, u); });
      if (!hasTable) {
        add('H1', 'Big heading', cmd('formatBlock', 'h1')); add('H2', 'Heading', cmd('formatBlock', 'h2')); add('H3', 'Small heading', cmd('formatBlock', 'h3')); add('Text', 'Normal paragraph', cmd('formatBlock', 'p'));
        add('• List', 'Bulleted list', cmd('insertUnorderedList')); add('1. List', 'Numbered list', cmd('insertOrderedList')); add('Quote', 'Quote', cmd('formatBlock', 'blockquote'));
      }
    }
    if (hasTable) {
      const cell = () => { const n = getSelection().anchorNode; const el = n && (n.nodeType === 1 ? n : n.parentElement); return el && el.closest('td,th'); };
      const idx = (c) => [...c.parentElement.children].indexOf(c);
      add('+ Row', 'Add a row below', () => { const c = cell(); const r = (c ? c.closest('tr') : host.querySelector('tbody tr:last-child, tr:last-child')); if (!r) return;
        const n = r.cloneNode(true); n.querySelectorAll('td,th').forEach((x) => { x.innerHTML = ''; }); (r.parentElement.tagName === 'THEAD' ? host.querySelector('tbody') || r.parentElement : r.parentElement).insertBefore(n, r.parentElement.tagName === 'THEAD' ? (host.querySelector('tbody') || r.parentElement).firstChild : r.nextSibling); });
      add('− Row', 'Delete this row', () => { const c = cell(); const r = c && c.closest('tr'); if (r && r.parentElement.tagName !== 'THEAD') r.remove(); });
      add('+ Column', 'Add a column to the right', () => { const c = cell(); const i = c ? idx(c) : host.querySelectorAll('tr')[0].children.length - 1;
        host.querySelectorAll('tr').forEach((r) => { const x = document.createElement(r.parentElement.tagName === 'THEAD' ? 'th' : 'td'); x.innerHTML = ''; r.insertBefore(x, r.children[i + 1] || null); }); });
      add('− Column', 'Delete this column', () => { const c = cell(); if (!c) return; const i = idx(c); if (c.parentElement.children.length < 2) return; host.querySelectorAll('tr').forEach((r) => r.children[i] && r.children[i].remove()); });
    }
    return bar;
  }

  // open one block for editing: as it looks on the page when it is plain text, lists, tables or code; raw text for anything else
  function openBlock(hit) {
    if (!editing || editing.source || editing.open) return;
    const isNew = !hit, eol = lineEnd(editing.draft), lines = editing.draft.split(eol);
    let start = 0, end = 0, body = '';
    if (!isNew) { start = +hit.data.dataset.line - 1; end = +hit.data.dataset.lineEnd; body = lines.slice(start, end).join('\n').replace(/\s+$/, ''); }
    const types = isNew ? [] : marked.lexer(body).filter((t) => t.type !== 'space').map((t) => t.type);
    const visual = !isNew && types.length === 1 && VISUAL.has(types[0]);
    const old = lines.slice(start, end), tail = [];
    while (old.length && old.at(-1).trim() === '') tail.unshift(old.pop());

    const wrap = document.createElement('div'); wrap.className = 'blk-wrap';
    let ta = null, host = null, startHtml = '';
    if (visual) {
      host = document.createElement('div'); host.className = 'md blk-visual'; host.contentEditable = 'true'; host.spellcheck = true;
      host.innerHTML = DOMPurify.sanitize(marked.parse(body));
      host.querySelectorAll('img').forEach((im) => {                       // show images from the folder, but remember what the file says
        const src = im.getAttribute('src') || ''; im.dataset.src = src;
        const full = join(dirOf(editing.path), decodeURI(src.split(/[?#]/)[0]));
        if (state.files.has(full)) im.src = blobUrl(full);
      });
      host.querySelectorAll('pre').forEach((p) => { p.contentEditable = 'plaintext-only'; });
      startHtml = host.innerHTML;
      wrap.append(toolbar(host, !!host.querySelector('table'), types[0] === 'code'), host);
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } else {
      ta = Object.assign(document.createElement('textarea'), { className: 'blk-edit', spellcheck: false, value: body });
      ta.setAttribute('aria-label', 'Edit this block');
      const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 4 + 'px'; };
      ta.oninput = grow; wrap.append(ta); setTimeout(grow, 0);
    }
    const anchor = hit ? hit.top : ($('#doc').lastElementChild || null);
    if (hit) hit.top.classList.add('hidden');
    if (anchor) anchor.after(wrap); else $('#doc').append(wrap);
    (host || ta).focus();

    let done = false;
    const finish = async (keep) => {
      if (done) return; done = true; editing.open = null;
      let text = null;
      if (keep) text = host ? (host.innerHTML === startHtml ? null : toMarkdown(host)) : ta.value.replace(/\r/g, '');
      wrap.remove(); if (hit) hit.top.classList.remove('hidden');
      if (text === null) return;                                              // nothing changed: the file keeps its exact text
      let next;
      if (isNew) next = text.trim() ? editing.draft.replace(/\s*$/, '') + eol + eol + text.replace(/\n/g, eol).replace(/\s+$/, '') + eol : editing.draft;
      else {
        const mid = text.trim() === '' ? [] : text.replace(/\s+$/, '').split('\n');
        const all = editing.draft.split(eol); all.splice(start, end - start, ...(mid.length ? [...mid, ...tail] : []));
        next = all.join(eol);
      }
      if (next !== editing.draft) { editing.draft = next; await show(next); }
    };
    editing.open = { apply: () => finish(true) };
    wrap.addEventListener('focusout', (e) => { if (!wrap.contains(e.relatedTarget)) setTimeout(() => { if (!wrap.contains(document.activeElement)) finish(true); }, 0); });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
    });
  }
  $('#doc').addEventListener('click', (e) => {
    if (!editing || editing.source) return;
    const hit = blockAt(e.target);
    if (!hit) return;
    e.preventDefault();                                           // links and anchors do not navigate while editing
    openBlock(hit);
  });
  q.add.onclick = () => openBlock(null);
  q.mode.onclick = toggleSource;

  async function save() {
    if (!editing) return;
    await settle();
    const { path } = editing, text = current(), name = baseName(path);
    q.save.disabled = true;
    try {
      let lastModified = Date.now();
      if (editing.real) {
        const { handle } = await fileHandle(path);
        if (!editing.stale && editing.file && !sameFile(await handle.getFile(), editing.file)) {
          editing.stale = true; q.status.textContent = 'This file changed on disk since you opened it. Press Save again to overwrite it.'; return;
        }
        const w = await handle.createWritable(); await w.write(text); await w.close();
        lastModified = (await handle.getFile()).lastModified;
      } else {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/markdown' })), download: name });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      state.files.set(path, new File([text], name, { type: 'text/markdown', lastModified }));
      stopEdit(); await reloadAll(true);
      toast('Saved');
    } catch (e) {
      q.status.textContent = 'Could not save: ' + (e.message || e.name);
    } finally { q.save.disabled = false; }
  }
  async function cancel() {
    await settle();
    if (dirty() && !confirm('Discard your changes?')) return;
    const { path, original } = editing;
    stopEdit(); state.texts.set(path, original); await render(path, '', true);
  }

  /* ---------- rename ---------- */
  const rnErr = (m) => { $('#rnErr').textContent = m || ''; };
  function startRename() {
    if (!state.current || editing) return;
    $('#rnInput').value = baseName(state.current); rnErr('');
    rename.classList.remove('hidden'); $('#docActions').classList.add('hidden');
    $('#rnInput').focus(); $('#rnInput').setSelectionRange(0, baseName(state.current).replace(MD_RE, '').length);
  }
  function stopRename() { rename.classList.add('hidden'); $('#docActions').classList.remove('hidden'); }
  rename.onsubmit = async (e) => {
    e.preventDefault();
    const old = state.current, name = $('#rnInput').value.trim();
    if (name === baseName(old)) return stopRename();
    if (!name || /[\\/:*?"<>|]/.test(name) || name.startsWith('.')) return rnErr('Use a plain file name, without / \\ : * ? " < > |');
    if (!MD_RE.test(name)) return rnErr('Keep the .md ending.');
    const next = dirOf(old) + name;
    if (state.files.has(next)) return rnErr('A file with that name already exists here.');
    try {
      let file = state.files.get(old), real = false;
      if (await askWrite()) {
        const { dir, handle } = await fileHandle(old);
        if (typeof handle.move === 'function') await handle.move(name);
        else {                                                // older browsers: write a new file, then remove the old one
          const text = await (await handle.getFile()).text();
          const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close();
          await dir.removeEntry(old.split('/').at(-1));
        }
        file = await (await dir.getFileHandle(name)).getFile(); real = true;
      } else file = new File([state.texts.get(old)], name, { type: 'text/markdown', lastModified: file.lastModified });
      state.files.delete(old); state.files.set(next, file);
      stopRename();
      state.current = next; await reloadAll(true); setHash(next);
      toast(real ? 'Renamed on your computer. Links in other files that use the old name are not changed.' : 'Renamed in this tab only. Your original file is not changed.', 4500);
    } catch (err) { rnErr('Could not rename: ' + (err.message || err.name)); }
  };

  /* ---------- wiring ---------- */
  $('#editBtn').onclick = startEdit;
  $('#renameBtn').onclick = startRename;
  $('#rnCancel').onclick = stopRename;
  q.save.onclick = save; $('#edCancel').onclick = cancel;
  addEventListener('keydown', (e) => {
    if (editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (e.key === 'Escape' && !rename.classList.contains('hidden')) stopRename();
  });
  addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  // Leaving the file (another file, a link, the file list) with unsaved edits: Save and leave / Discard / Stay.
  const leave = document.createElement('div');
  leave.className = 'modal hidden'; leave.setAttribute('role', 'dialog'); leave.setAttribute('aria-modal', 'true');
  leave.innerHTML = `<div class="modal-box"><h3>You have unsaved changes</h3><p id="lvMsg"></p>
    <div class="modal-btns"><button class="btn" data-c="stay">Keep editing</button><button class="btn" data-c="discard">Discard changes</button><button class="btn primary" data-c="save">Save and continue</button></div></div>`;
  document.body.append(leave);
  const choose = () => new Promise((resolve) => {
    $('#lvMsg').textContent = `You changed ${editing.path}. Save it before you leave, or the changes are lost.`;
    leave.classList.remove('hidden');
    leave.onclick = (e) => { const c = e.target.dataset && e.target.dataset.c; if (c) { leave.classList.add('hidden'); resolve(c); } };
  });
  let busy = false;
  addEventListener('hashchange', async () => {
    if (!editing || busy) return;
    const h = parseHash();
    if (h && h.path === editing.path) return;                     // only a heading link inside the same file
    busy = true;
    try {
      const old = editing.path;
      if (dirty()) {
        const c = await choose();
        if (c === 'stay') { setHash(old); return; }               // back to the file; nothing is lost
        if (c === 'save') { await save(); if (editing) { setHash(old); return; } }   // save failed or needs confirming: stay
        if (editing) { state.texts.set(old, editing.original); stopEdit(); }
      } else { state.texts.set(old, editing.original); stopEdit(); }
    } finally { setTimeout(() => { busy = false; }, 0); }
  });
})();
