/* Install as an app, reading options, image zoom, and local notes (kept in this browser; sign-in needed to create). */
(() => {
  const $ = (s) => document.querySelector(s);
  const onWeb = /^https?:$/.test(location.protocol);
  const WS = 'My notes (local)';

  /* ---------- install as an app (PWA) ---------- */
  if (onWeb && 'serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  let installEvt = null;
  const installBtn = Object.assign(document.createElement('button'), { className: 'btn hidden', id: 'installBtn', title: 'Install as an app on this computer', innerHTML: '<span>Install app</span>' });
  $('#themeBtn').before(installBtn);
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; installBtn.classList.remove('hidden'); });
  installBtn.onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; installBtn.classList.add('hidden'); };
  addEventListener('appinstalled', () => { installBtn.classList.add('hidden'); toast('Installed. Find it in your apps.'); });
  if ('launchQueue' in window) launchQueue.setConsumer(async (p) => {      // .md files opened with the installed app
    if (!p.files.length) return;
    const items = [];
    for (const h of p.files) { const file = await h.getFile(); items.push({ path: file.name, file }); }
    load(items, items.length === 1 ? items[0].path : 'Opened files');
  });

  /* ---------- "new version ready" bar: compares the file versions in this page with the live page ---------- */
  const verOf = (list) => [...list].sort().join('|');
  const mineVer = verOf([...document.querySelectorAll('[src*="?v="],[href*="?v="]')].map((e) => e.getAttribute('src') || e.getAttribute('href')));
  async function checkUpdate() {
    if (!onWeb || $('#updBar')) return;
    try {
      const html = await (await fetch('/', { cache: 'no-store' })).text();
      if (verOf([...html.matchAll(/(?:src|href)="([^"]*\?v=[^"]*)"/g)].map((m) => m[1])) === mineVer) return;
      const bar = Object.assign(document.createElement('div'), { id: 'updBar', className: 'upd-bar', innerHTML: '<span>A new version is ready.</span><button class="btn primary">Reload</button><button class="btn" aria-label="Dismiss">✕</button>' });
      const [go, no] = bar.querySelectorAll('button');
      go.onclick = () => { if (document.body.classList.contains('editing')) { toast('Save or cancel your edit first, then reload.'); return; } location.reload(); };
      no.onclick = () => bar.remove();
      document.body.append(bar);
    } catch (e) { /* offline or blocked: try again later */ }
  }
  window.mdvCheckUpdate = checkUpdate;
  if (onWeb) { setTimeout(checkUpdate, 8000); setInterval(checkUpdate, 30 * 60 * 1000); document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); }); }

  /* ---------- reading options: width and text size ---------- */
  const prefs = { w: 'normal', s: 0, ...JSON.parse((() => { try { return localStorage.getItem('mdv-read') || '{}'; } catch { return '{}'; } })()) };
  const WIDTH = { narrow: '700px', normal: '860px', wide: '1120px' };
  const applyPrefs = () => {
    document.documentElement.style.setProperty('--read-w', WIDTH[prefs.w] || WIDTH.normal);
    document.documentElement.style.setProperty('--read-fs', (16 + prefs.s * 1.5) + 'px');
    try { localStorage.setItem('mdv-read', JSON.stringify(prefs)); } catch {}
    document.querySelectorAll('#readMenu [data-w]').forEach((b) => b.classList.toggle('on', b.dataset.w === prefs.w));
  };
  const wrap = Object.assign(document.createElement('div'), { className: 'menu-wrap when-loaded' });
  wrap.innerHTML = `<button class="btn icon-btn" id="readBtn" aria-haspopup="true" aria-expanded="false" title="Reading options" aria-label="Reading options"><b style="font-size:13px">Aa</b></button>
    <div class="menu hidden" id="readMenu" role="menu">
      <div class="lbl">Page width</div>
      <div class="row seg"><button data-w="narrow">Narrow</button><button data-w="normal">Normal</button><button data-w="wide">Wide</button></div>
      <div class="lbl">Text size</div>
      <div class="row seg"><button data-s="-1" aria-label="Smaller text">A−</button><button data-s="0">Reset</button><button data-s="1" aria-label="Larger text">A+</button></div>
    </div>`;
  $('#themeBtn').before(wrap);
  bindMenu($('#readBtn'), $('#readMenu'));
  $('#readMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.w) prefs.w = b.dataset.w;
    if (b.dataset.s) prefs.s = b.dataset.s === '0' ? 0 : Math.max(-2, Math.min(5, prefs.s + +b.dataset.s));
    applyPrefs();
  });
  applyPrefs();

  /* ---------- click an image to see it large ---------- */
  $('#doc').addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (!img || img.closest('a') || document.body.classList.contains('editing-blocks') || !img.src) return;
    MD.openZoom(img);
  });

  /* ---------- local notes ---------- */
  const STARTER = '# Welcome\n\nThese notes live in this browser. Nothing is uploaded.\n\n- Use **+ File** and **+ Folder** in the list on the left.\n- Click **Edit**, then click any paragraph to change it.\n- Use the download button to save a `.md` or a `.zip` copy any time.\n\n```mermaid\nflowchart LR\n  A[Write] --> B[Read] --> C[Share]\n```\n';
  const isWs = () => state.root === WS && !document.body.classList.contains('shared-view');
  const ask = ({ title, text, value = '', ok = 'Create', input = true }) => new Promise((resolve) => {
    const m = Object.assign(document.createElement('div'), { className: 'ws-modal' });
    m.innerHTML = `<form class="ws-card"><h3></h3><p></p>${input ? '<input maxlength="120" autocomplete="off" spellcheck="false">' : ''}<div class="acts"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">${ok}</button></div></form>`;
    m.querySelector('h3').textContent = title; m.querySelector('p').textContent = text;
    const inp = m.querySelector('input'); if (inp) inp.value = value;
    const done = (v) => { m.remove(); resolve(v); };
    m.querySelector('[data-x]').onclick = () => done(null);
    m.onclick = (e) => { if (e.target === m) done(null); };
    m.querySelector('form').onsubmit = (e) => { e.preventDefault(); done(inp ? inp.value.trim() : true); };
    document.body.append(m); (inp || m.querySelector('.primary')).focus(); inp?.select();
  });
  const cleanPath = (raw, isFolder) => {
    let p = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
    if (!p || p.split('/').some((s) => s === '..' || s.startsWith('.') || /[:*?"<>|]/.test(s))) return '';
    return isFolder ? p + '/README.md' : /\.(md|markdown|mdx|txt)$/i.test(p) ? p : p + '.md';
  };
  const readWs = async () => { try { return (await idb('readonly', (s) => s.get('workspace'))) || null; } catch { return null; } };
  let saved = '';
  async function persist() {
    if (!isWs()) return;
    const json = JSON.stringify([...state.texts]);
    if (json === saved) return;
    saved = json;
    try { await idb('readwrite', (s) => s.put({ files: Object.fromEntries(state.texts) }, 'workspace')); } catch { toast('Could not save your notes in this browser.'); }
  }
  const toFiles = (map) => [...map].map(([path, text]) => ({ path, file: new File([text], path.slice(path.lastIndexOf('/') + 1), { type: 'text/markdown' }) }));
  async function requireSignIn() {
    const A = window.mdvAuth;
    if (!A) { toast('Sign-in is only available on the website.'); return false; }
    if (A.user || (await A.whoAmI())) return true;
    toast('Sign in with Google to create notes. They stay on this device.', 4000);
    return !!(await A.signIn());
  }
  async function openNotes(forceCreate) {
    if (!(await requireSignIn())) return;
    const ws = await readWs();
    const files = ws && Object.keys(ws.files).length ? ws.files : { 'Welcome.md': STARTER };
    state.dirHandle = null;
    await load(toFiles(new Map(Object.entries(files))), WS);
    saved = JSON.stringify([...state.texts]);
    if (!ws) persist();
    syncUi();
  }
  async function addFile(path, text) {
    if (!isWs()) {                                            // an opened folder or a shared doc: edit.js creates the file
      const msg = await window.mdvCreate(path, text);
      if (msg) { toast(msg, 4500); return false; }
      go(path); syncUi(); return true;
    }
    const next = new Map(state.texts);
    if (next.has(path)) { toast('That file already exists.'); return false; }
    next.set(path, text);
    await load(toFiles(next), WS, true);
    await persist(); go(path); syncUi(); return true;
  }
  async function newFile() {
    const dir = state.current ? dirOf(state.current) : '';
    const v = await ask({ title: 'New file', text: 'Name it. Use folder/name to put it in a folder.', value: dir });
    if (!v) return;
    const p = cleanPath(v, false); if (!p) { toast('Use a plain name, without .. : * ? " < > |'); return; }
    if (await addFile(p, '# ' + baseName(p).replace(MD_RE, '') + '\n\n')) setTimeout(() => $('#editBtn').click(), 250);
  }
  async function newFolder() {
    const v = await ask({ title: 'New folder', text: 'A folder is created with a README.md inside it.' });
    if (!v) return;
    const p = cleanPath(v, true); if (!p) { toast('Use a plain name, without .. : * ? " < > |'); return; }
    await addFile(p, '# ' + p.split('/').at(-2) + '\n\n');
  }
  async function deleteFile() {
    const p = state.current; if (!p || !isWs()) return;
    if (!(await ask({ title: 'Delete this file?', text: `${p} will be removed from your local notes. This cannot be undone.`, ok: 'Delete', input: false }))) return;
    const next = new Map(state.texts); next.delete(p);
    if (!next.size) next.set('Welcome.md', STARTER);
    state.current = null;
    await load(toFiles(next), WS, true);
    await persist(); syncUi(); toast('Deleted');
  }
  const mk = (label, title, fn, cls) => { const b = Object.assign(document.createElement('button'), { className: cls, textContent: label, title, onclick: fn }); $('#treeTools').append(b); return b; };
  mk('+ File', 'New file', newFile, 'new-only'); mk('+ Folder', 'New folder', newFolder, 'new-only'); mk('Delete file', 'Delete the open file', deleteFile, 'ws-only');
  function syncUi() {
    const b = document.body;
    b.classList.toggle('ws-active', isWs());
    b.classList.toggle('can-create', b.classList.contains('loaded') && (isWs() || !b.classList.contains('shared-view') || b.classList.contains('can-edit')));
  }
  // entry points: start page button and the Open menu
  const startBtn = Object.assign(document.createElement('button'), { className: 'btn big', id: 'notesBtn', textContent: 'Write notes', title: 'Create Markdown files and folders that stay in this browser' });
  $('#openFilesBtn').after(startBtn); startBtn.onclick = () => openNotes();
  const item = Object.assign(document.createElement('button'), { role: 'menuitem', innerHTML: '<b>My notes (local)</b><small>Create files and folders, kept in this browser</small>' });
  $('#openFilesItem').after(item); item.onclick = () => openNotes();
  if (!onWeb) { startBtn.remove(); item.remove(); }
  readWs().then((ws) => { if (ws) startBtn.textContent = 'Open my notes'; });
  setInterval(syncUi, 250); setInterval(persist, 1200);
  addEventListener('pagehide', persist);
})();
