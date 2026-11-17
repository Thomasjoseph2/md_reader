/* Share links, the account menu, "Your shared links", and opening shared links (?s=ID). Website only. */
(() => {
  const $ = (s) => document.querySelector(s);
  const SITE = 'https://markdown-viewer-online.vercel.app';
  const onWeb = /^https?:$/.test(location.protocol);        // false inside the Chrome extension or a file:// page
  const linkBase = (onWeb ? location.origin : SITE) + '/?s=';

  const api = async (name, body) => {
    const r = await fetch(`/api/${name}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = {}; try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  };
  const show = (sel, on) => $(sel).classList.toggle('hidden', !on);
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const h = (tag, props = {}, ...kids) => {                 // tiny DOM builder (text only, so nothing is ever parsed as HTML)
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.filter((k) => k != null)); return n;
  };
  let me = null;

  /* ---------- who is signed in ---------- */
  const personIcon = onWeb ? $('#profileBtn').innerHTML : '';
  async function whoAmI() { try { me = (await api('auth/me')).data.user || null; } catch { me = null; } updateProfile(); return me; }

  function updateProfile() {
    const btn = $('#profileBtn');
    $('#profileWrap').classList.toggle('hidden', !onWeb);
    btn.classList.toggle('in', !!me);
    btn.title = me ? `Signed in as ${me.email}` : 'Sign in';
    btn.replaceChildren();
    if (!me) { btn.innerHTML = personIcon; return; }
    const initial = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
    if (me.picture) {
      btn.append(h('img', { src: me.picture, alt: '', referrerPolicy: 'no-referrer', onerror() { this.replaceWith(initial); } }));
    } else btn.append(initial);
  }

  // Google sign-in runs in a small popup so the folder you opened stays on this page. Google's pages cut the link
  // between the popup and this page, so we do not rely on it: the popup pings a same-origin channel when it is done,
  // and we also check the session every couple of seconds (for up to 3 minutes).
  let signInRun = 0;
  function signIn() {
    const run = ++signInRun;                                  // a newer click replaces an older wait
    return new Promise((resolve) => {
      const w = window.open('/api/auth/google?popup=1&return=' + encodeURIComponent('/'), 'mdv-signin', 'width=480,height=640');
      if (!w) { location.href = '/api/auth/google?return=' + encodeURIComponent(location.pathname + location.search); return; }
      let done = false, bc, timer;
      const stopAt = Date.now() + 180000;
      const finish = (user) => {
        if (done) return; done = true; clearInterval(timer);
        if (bc) bc.close(); removeEventListener('message', onMsg);
        resolve(user);
      };
      const check = async () => {
        if (run !== signInRun) return finish(null);
        const u = await whoAmI();
        if (u) { try { w.close(); } catch {} finish(u); } else if (Date.now() > stopAt) finish(null);
      };
      const onMsg = (e) => { if (e.origin === location.origin && e.data && e.data.mdvAuth) check(); };
      addEventListener('message', onMsg);
      try { bc = new BroadcastChannel('mdv-auth'); bc.onmessage = check; } catch {}
      timer = setInterval(check, 2000);
    });
  }
  async function signOut() { await api('auth/logout', {}); me = null; updateProfile(); toast('Signed out'); }

  function renderProfileMenu() {
    const box = $('#profileMenu'); box.replaceChildren();
    const item = (title, sub, fn) => { const b = h('button', { role: 'menuitem', onclick: fn }, h('b', { textContent: title })); if (sub) b.append(h('small', { textContent: sub })); return b; };
    if (!me) { box.append(item('Sign in with Google', 'To share docs with a link', () => signIn())); return; }
    box.append(h('div', { className: 'who' }, h('b', { textContent: me.name || me.email }), h('small', { textContent: me.email })),
      h('div', { className: 'menu-sep' }),
      item('Your shared links', null, openLinks),
      item('Sign out', null, signOut));
  }

  /* ---------- the access choice (used by Share and by Edit) ---------- */
  let accSeq = 0;
  function buildAccess(init = {}, { expiry = false } = {}) {
    const name = 'acc' + (++accSeq), vis = init.visibility || 'link';
    const root = h('div');
    root.innerHTML = `
      <div class="acc">
        <label class="acc-opt"><input type="radio" name="${name}" value="link"><b>Anyone with the link</b><small>No sign-in needed</small></label>
        <label class="acc-opt"><input type="radio" name="${name}" value="restricted"><b>Only people I add</b><small>They sign in with Google</small></label>
      </div>
      <label class="acc-field acc-emails"><span>Emails, one per line</span><textarea rows="3" placeholder="name@company.com"></textarea></label>
      <details class="acc-more"><summary>More options</summary>
        <label class="acc-field acc-pw"><span>Password</span><input type="password" maxlength="200" autocomplete="new-password"></label>
        <label class="acc-check acc-rm hidden"><input type="checkbox"> Remove the password</label>
        <label class="acc-field acc-days"><span>Keep the link for</span><select><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label>
      </details>`;
    const q = (s) => root.querySelector(s);
    const emails = q('textarea'), pw = q('.acc-pw input'), rm = q('.acc-rm input'), days = q('select'), more = q('.acc-more');
    root.querySelector(`input[value="${vis}"]`).checked = true;
    emails.value = (init.emails || []).join('\n');
    days.value = '30';
    if (init.protected) { pw.placeholder = 'A password is set. Type a new one to change it'; q('.acc-rm').classList.remove('hidden'); }
    if (!expiry) q('.acc-days').classList.add('hidden');
    const current = () => root.querySelector(`input[name="${name}"]:checked`).value;
    const sync = () => {
      const r = current() === 'restricted';
      q('.acc-emails').classList.toggle('hidden', !r);
      q('.acc-pw').classList.toggle('hidden', r);
      if (init.protected) q('.acc-rm').classList.toggle('hidden', r);
      more.classList.toggle('hidden', r && !expiry);          // nothing to show there for a restricted link being edited
    };
    root.addEventListener('change', sync); sync();
    return {
      el: root,
      focus() { (current() === 'restricted' ? emails : root.querySelector('input[type=radio]:checked')).focus(); },
      values: () => ({ visibility: current(), emails: emails.value.split(/[\s,;]+/).filter(Boolean), password: pw.value || undefined, removePassword: rm.checked, days: +days.value }),
    };
  }

  /* ---------- Share dialog ---------- */
  const modal = $('#shareModal');
  const sections = ['#shSignin', '#shForm', '#shDone', '#shWeb'];
  const only = (sel) => sections.forEach((s) => show(s, s === sel));
  const closeShare = () => modal.classList.add('hidden');
  let access;

  async function openShare() {
    modal.classList.remove('hidden');
    if (!onWeb) return only('#shWeb');
    if (!me) await whoAmI();
    if (!me) return only('#shSignin');
    showForm();
  }
  function showForm() {
    const n = state.texts.size, bytes = [...state.texts.values()].reduce((a, t) => a + new Blob([t]).size, 0);
    const size = bytes < 1048576 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
    access = buildAccess({ visibility: 'link' }, { expiry: true });
    $('#shAccessMount').replaceChildren(access.el);
    $('#shNote').textContent = `Uploads the text of ${n} file${n === 1 ? '' : 's'} (${size}) to the cloud. Images are not included. You can remove the link any time.`;
    show('#shErr', false);
    $('#shCreate').disabled = false; $('#shCreate').textContent = 'Create link';
    only('#shForm');
  }

  async function create() {
    const btn = $('#shCreate'); btn.disabled = true; btn.textContent = 'Uploading…'; show('#shErr', false);
    try {
      const v = access.values();
      const { ok, status, data } = await api('share', {
        title: state.root, files: Object.fromEntries(state.texts), visibility: v.visibility, emails: v.emails,
        password: v.visibility === 'link' ? v.password : undefined, days: v.days,
      });
      if (status === 401) { me = null; updateProfile(); return only('#shSignin'); }
      if (!ok) throw new Error(data.error || 'Could not create the link.');
      const url = linkBase + data.id;
      $('#shUrl').value = url;
      const who = v.visibility === 'restricted' ? `${v.emails.length} ${v.emails.length === 1 ? 'person' : 'people'} can open it` : v.password ? 'anyone with the link and the password' : 'anyone with the link';
      let copied = false; try { await navigator.clipboard.writeText(url); copied = true; } catch {}
      $('#shDoneMeta').textContent = `${copied ? 'Link copied. ' : 'Your link is ready. '}${who[0].toUpperCase() + who.slice(1)} · expires ${fmtDate(data.expiresAt)}.`;
      only('#shDone'); $('#shUrl').select();
    } catch (e) {
      $('#shErr').textContent = e.message || 'Could not create the link.'; show('#shErr', true);
      btn.disabled = false; btn.textContent = 'Create link';
    }
  }

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch { const i = $('#shUrl'); i.value = text; i.select(); document.execCommand('copy'); }
    if (btn) { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = o), 1500); }
  }

  /* ---------- Your shared links ---------- */
  const linksModal = $('#linksModal');
  const closeLinks = () => linksModal.classList.add('hidden');
  let linksSeq = 0;

  function openLinks() { linksModal.classList.remove('hidden'); renderLinks(); }

  async function renderLinks() {
    const seq = ++linksSeq, box = $('#linksList');
    if (!box.children.length) box.replaceChildren(h('p', { className: 'lk-empty', textContent: 'Loading…' }));
    const { ok, status, data } = await api('mylinks', {});
    if (seq !== linksSeq) return;                              // a newer request replaced this one
    if (status === 401) { me = null; updateProfile(); closeLinks(); return; }
    if (!ok) { box.replaceChildren(h('p', { className: 'lk-empty', textContent: 'Could not load your links. Try again.' })); return; }
    if (!data.links.length) { box.replaceChildren(h('p', { className: 'lk-empty', textContent: 'Nothing shared yet. Open a folder and click Share.' })); return; }
    box.replaceChildren(...data.links.map(linkRow));
  }

  function linkRow(m) {
    const who = m.visibility === 'restricted' ? `${m.emails.length} ${m.emails.length === 1 ? 'person' : 'people'}` : m.protected ? 'Anyone with the link and password' : 'Anyone with the link';
    const row = h('div', { className: 'lk' });
    const copyBtn = h('button', { className: 'btn', textContent: 'Copy link', onclick: () => copy(linkBase + m.id, copyBtn) });
    const editBtn = h('button', { className: 'btn', textContent: 'Edit', onclick: () => toggleEdit() });
    const delBtn = h('button', { className: 'btn', textContent: 'Remove' });
    let armed = 0;
    delBtn.onclick = async () => {                             // two clicks to remove, so it is never an accident
      if (!armed) { armed = setTimeout(() => { armed = 0; delBtn.textContent = 'Remove'; delBtn.classList.remove('danger'); }, 3000); delBtn.textContent = 'Sure?'; delBtn.classList.add('danger'); return; }
      clearTimeout(armed); delBtn.disabled = true; delBtn.textContent = 'Removing…';
      const r = await api('unshare', { id: m.id });
      if (r.ok) renderLinks(); else { delBtn.disabled = false; delBtn.textContent = 'Remove'; toast('Could not remove the link. Try again.'); }
    };
    row.append(h('div', { className: 'lk-top' },
      h('div', { className: 'lk-info' }, h('a', { href: linkBase + m.id, target: '_blank', rel: 'noopener', textContent: m.title }),
        h('small', { textContent: `${who} · ${m.fileCount} file${m.fileCount === 1 ? '' : 's'} · expires ${fmtDate(m.expiresAt)}` })),
      h('div', { className: 'lk-btns' }, copyBtn, editBtn, delBtn)));

    let editor = null;
    function toggleEdit() {
      if (editor) { editor.remove(); editor = null; return; }
      const acc = buildAccess({ visibility: m.visibility, emails: m.emails, protected: m.protected });
      const err = h('p', { className: 'sh-err hidden' });
      const save = h('button', { className: 'btn primary', textContent: 'Save' });
      const cancel = h('button', { className: 'btn', textContent: 'Cancel', onclick: () => toggleEdit() });
      save.onclick = async () => {
        const v = acc.values(); save.disabled = true; save.textContent = 'Saving…'; err.classList.add('hidden');
        const r = await api('access', { id: m.id, visibility: v.visibility, emails: v.emails, password: v.password, removePassword: v.removePassword });
        if (r.ok) { toast('Saved'); renderLinks(); }
        else { err.textContent = r.data.error || 'Could not save.'; err.classList.remove('hidden'); save.disabled = false; save.textContent = 'Save'; }
      };
      editor = h('div', { className: 'lk-edit' }, acc.el, err, h('div', { className: 'modal-btns' }, cancel, save));
      row.append(editor); acc.focus();
    }
    return row;
  }

  /* ---------- wiring ---------- */
  $('#shareBtn').onclick = openShare;
  $('#shCancel').onclick = $('#shClose').onclick = $('#shSigninCancel').onclick = $('#shWebClose').onclick = closeShare;
  $('#shSigninBtn').onclick = async () => { if (await signIn()) showForm(); };
  $('#shCreate').onclick = create;
  $('#shCopy').onclick = (e) => copy($('#shUrl').value, e.currentTarget);
  $('#shManage').onclick = () => { closeShare(); openLinks(); };
  $('#linksClose').onclick = closeLinks;
  for (const m of [modal, linksModal]) m.addEventListener('mousedown', (e) => { if (e.target === m) m.classList.add('hidden'); });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const m of [modal, linksModal]) if (!m.classList.contains('hidden')) { m.classList.add('hidden'); break; }
  });
  if (onWeb) {
    bindMenu($('#profileBtn'), $('#profileMenu'), renderProfileMenu);
    updateProfile();                                         // show the icon at once; the photo follows when the session is known
    whoAmI();
  }

  /* ---------- open a shared link (?s=ID) ---------- */
  const id = new URLSearchParams(location.search).get('s');
  if (!id || !onWeb) return;

  const pwModal = $('#pwModal'), authModal = $('#authModal');
  const askPassword = (wrong) => new Promise((resolve) => {
    $('#pwErr').textContent = wrong ? 'Wrong password. Try again.' : ''; show('#pwErr', !!wrong);
    $('#pwInput').value = ''; pwModal.classList.remove('hidden'); $('#pwInput').focus();
    $('#pwForm').onsubmit = (e) => { e.preventDefault(); pwModal.classList.add('hidden'); resolve($('#pwInput').value); };
  });
  // Resolves once the visitor is signed in (with a different account first, when they were refused).
  const askAuth = ({ title, msg, btn, switchAccount }) => new Promise((resolve) => {
    $('#auTitle').textContent = title; $('#auMsg').textContent = msg; $('#auBtn').textContent = btn;
    authModal.classList.remove('hidden');
    $('#auBtn').onclick = async () => {
      if (switchAccount) await signOut();
      if (await signIn()) { authModal.classList.add('hidden'); resolve(); }
    };
  });

  (async () => {
    try {
      toast('Opening shared docs…', 0);
      let password, res;
      for (;;) {
        res = await api('doc', { id, password });
        if (res.status === 401 && res.data.needsLogin) {
          await askAuth({ title: 'Sign in to open this doc', msg: 'The owner shared this doc with specific people. Sign in with Google to continue.', btn: 'Sign in with Google' });
          continue;
        }
        if (res.status === 403) {
          await askAuth({ title: 'No access', msg: res.data.error, btn: 'Use a different Google account', switchAccount: true });
          continue;
        }
        if (res.status === 401 && res.data.needsPassword) { password = await askPassword(res.data.wrong); continue; }
        break;
      }
      if (!res.ok) { toast(res.data.error || 'This link does not exist or has expired.', 0); return; }
      const { title, files, expiresAt } = res.data;
      document.body.classList.add('shared-view');
      await load(Object.entries(files).map(([path, text]) => ({ path, file: new File([text], path.slice(path.lastIndexOf('/') + 1), { type: 'text/markdown' }) })), title);
      const note = h('span', { className: 'shared-note hide-sm', textContent: `Shared with you · read-only · expires ${fmtDate(expiresAt)}` });
      $('#rootName').after(note);
    } catch {
      toast('Could not open this link. Check your connection and try again.', 0);
    }
  })();
})();
