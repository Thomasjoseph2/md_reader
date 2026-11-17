/* Edit and rename Markdown files.
   - Folder opened with the browser's folder picker (Chrome, Edge): Edit asks permission once, then saves to the REAL file.
   - Anything else (other browsers, dropped or uploaded files): Edit changes the copy in this tab and Save downloads the file. */
(() => {
  const $ = (s) => document.querySelector(s);
  const canWriteDisk = () => !!(state.dirHandle && typeof state.dirHandle.requestPermission === 'function');
  let editing = null;                        // { path, real, original, stale }

  const wrap = $('.doc-wrap');
  const editor = document.createElement('section');
  editor.id = 'editor'; editor.className = 'editor hidden';
  editor.innerHTML = `
    <p class="edit-banner" id="edBanner"></p>
    <textarea id="edText" spellcheck="false" aria-label="Edit Markdown"></textarea>
    <div class="edit-bar"><button class="btn primary" id="edSave">Save</button><button class="btn" id="edCancel">Cancel</button><span id="edStatus"></span></div>`;
  $('#doc').before(editor);
  const rename = document.createElement('form');
  rename.id = 'renameRow'; rename.className = 'rename-row hidden';
  rename.innerHTML = `<input id="rnInput" maxlength="150" aria-label="New file name" autocomplete="off"><button class="btn primary" type="submit">Rename</button><button class="btn" type="button" id="rnCancel">Cancel</button><span id="rnErr" class="rn-err"></span>`;
  $('#docActions').after(rename);

  const q = { text: $('#edText'), banner: $('#edBanner'), status: $('#edStatus'), save: $('#edSave') };
  const dirty = () => editing && q.text.value !== editing.original;
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

  /* ---------- edit ---------- */
  async function startEdit() {
    if (editing || !state.current) return;
    const path = state.current, real = await askWrite();
    editing = { path, real, original: state.texts.get(path), stale: false, file: state.files.get(path) };
    q.text.value = editing.original;
    q.banner.className = 'edit-banner ' + (real ? 'real' : 'copy');
    q.banner.textContent = real
      ? `You are editing the real file on your computer: ${state.root}/${path}. Save writes to it.`
      : 'You are editing a copy in this tab. Save downloads the edited file; your original is not changed.';
    q.status.textContent = '';
    document.body.classList.add('editing');
    editor.classList.remove('hidden'); $('#doc').classList.add('hidden'); q.text.focus();
  }
  function stopEdit() {
    editing = null;
    document.body.classList.remove('editing');
    editor.classList.add('hidden'); $('#doc').classList.remove('hidden');
  }
  async function save() {
    if (!editing) return;
    const { path } = editing, text = q.text.value, name = baseName(path);
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
  function cancel() {
    if (dirty() && !confirm('Discard your changes?')) return;
    stopEdit();
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
  addEventListener('hashchange', () => {                      // moving to another file while editing
    if (!editing) return;
    if (dirty() && !confirm('Discard your changes?')) { setHash(editing.path); return; }
    stopEdit();
  });
})();
