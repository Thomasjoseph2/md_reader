/* Share links: sign in with Google, upload the open docs on request, and open shared links (read-only). */
(() => {
  const $ = (s) => document.querySelector(s);
  const SITE = 'https://markdown-viewer-online.vercel.app';
  const onWeb = /^https?:$/.test(location.protocol);        // false inside the Chrome extension or a file:// page
  const linkBase = (onWeb ? location.origin : SITE) + '/?s=';

  const api = async (name, body) => {
    const r = await fetch(`/api/${name}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    let data = {}; try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  };
  const show = (sel, on) => $(sel).classList.toggle('hidden', !on);
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  let me = null;

  async function whoAmI() { try { me = (await api('auth/me')).data.user || null; } catch { me = null; } return me; }

  // Google sign-in runs in a small popup so the folder you opened stays on this page. Google's pages cut the link
  // between the popup and this page, so we do not rely on it: the popup pings a same-origin channel when it is done,
  // and we also check the session every couple of seconds (for up to 3 minutes).
  let signInRun = 0;
  function signIn() {
    const run = ++signInRun;                                  // a newer click replaces an older wait
    return new Promise((resolve) => {
      const w = window.open('/api/auth/google?popup=1&return=' + encodeURIComponent('/'), 'mdv-signin', 'width=480,height=640');
      if (!w) { location.href = '/api/auth/google?return=' + encodeURIComponent(location.pathname + location.search); return; }
      let done = false, bc, timer, stopAt = Date.now() + 180000;
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

  /* ---- share dialog ---- */
  const modal = $('#shareModal');
  const sections = ['#shSignin', '#shForm', '#shDone', '#shWeb'];
  const only = (sel) => sections.forEach((s) => show(s, s === sel));
  const closeShare = () => modal.classList.add('hidden');
  const vis = () => document.querySelector('input[name="shVis"]:checked').value;
  const syncVis = () => { show('#shEmailsRow', vis() === 'restricted'); show('#shPwRow', vis() === 'link'); };

  async function openShare() {
    modal.classList.remove('hidden'); show('#shMine', false);
    if (!onWeb) return only('#shWeb');
    if (!me) await whoAmI();
    if (!me) return only('#shSignin');
    showForm();
  }
  function showForm() {
    const n = state.texts.size, bytes = [...state.texts.values()].reduce((a, t) => a + new Blob([t]).size, 0);
    $('#shCount').textContent = `${n} file${n === 1 ? '' : 's'}, ${bytes < 1048576 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB'}`;
    $('#shUser').textContent = `Signed in as ${me.email}`;
    $('#shPw').value = ''; $('#shEmails').value = ''; show('#shErr', false); syncVis();
    $('#shCreate').disabled = false; $('#shCreate').textContent = 'Create link';
    only('#shForm'); renderMine();
  }

  async function create() {
    const btn = $('#shCreate'); btn.disabled = true; btn.textContent = 'Uploading…'; show('#shErr', false);
    try {
      const emails = $('#shEmails').value.split(/[\s,;]+/).filter(Boolean);
      const { ok, status, data } = await api('share', {
        title: state.root, files: Object.fromEntries(state.texts), visibility: vis(),
        emails: vis() === 'restricted' ? emails : [], password: vis() === 'link' ? $('#shPw').value || undefined : undefined, days: +$('#shDays').value,
      });
      if (status === 401) { me = null; return only('#shSignin'); }
      if (!ok) throw new Error(data.error || 'Could not create the link.');
      $('#shUrl').value = linkBase + data.id;
      $('#shDoneMeta').textContent = ` (${vis() === 'restricted' ? `${emails.length} ${emails.length === 1 ? 'person' : 'people'} can open it` : $('#shPw').value ? 'anyone with the link, password protected' : 'anyone with the link'}, expires ${fmtDate(data.expiresAt)})`;
      only('#shDone'); renderMine(); $('#shUrl').select();
    } catch (e) {
      $('#shErr').textContent = e.message || 'Could not create the link.'; show('#shErr', true);
      btn.disabled = false; btn.textContent = 'Create link';
    }
  }

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch { const i = $('#shUrl'); i.value = text; i.select(); document.execCommand('copy'); }
    if (btn) { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = o), 1500); }
  }

  let mineSeq = 0;
  async function renderMine() {
    const seq = ++mineSeq;                               // only the newest request may draw
    const { ok, data } = await api('mylinks', {});
    if (seq !== mineSeq) return;
    const list = ok ? data.links : [];
    show('#shMine', list.length > 0);
    const box = $('#shMineList'); box.textContent = '';
    for (const m of list) {
      const row = document.createElement('div'); row.className = 'sh-item';
      const t = document.createElement('span'); t.className = 't'; t.textContent = m.title;
      const s = document.createElement('small');
      s.textContent = `${m.visibility === 'restricted' ? `${m.emails.length} invited` : m.protected ? 'Anyone with link + password' : 'Anyone with link'} · expires ${fmtDate(m.expiresAt)}`;
      t.append(s);
      const c = document.createElement('button'); c.className = 'btn'; c.textContent = 'Copy link'; c.onclick = () => copy(linkBase + m.id, c);
      const d = document.createElement('button'); d.className = 'btn'; d.textContent = 'Remove';
      d.onclick = async () => {
        d.disabled = true; d.textContent = 'Removing…';
        const r = await api('unshare', { id: m.id });
        if (r.ok) renderMine(); else { d.disabled = false; d.textContent = 'Remove'; toast('Could not remove the link. Try again.'); }
      };
      row.append(t, c, d); box.append(row);
    }
  }

  $('#shareBtn').onclick = openShare;
  $('#shCancel').onclick = $('#shClose').onclick = $('#shSigninCancel').onclick = $('#shWebClose').onclick = closeShare;
  $('#shSigninBtn').onclick = async () => { if (await signIn()) showForm(); };
  $('#shCreate').onclick = create;
  $('#shCopy').onclick = (e) => copy($('#shUrl').value, e.currentTarget);
  document.querySelectorAll('input[name="shVis"]').forEach((r) => r.addEventListener('change', syncVis));
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeShare(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeShare(); });

  /* ---- open a shared link (?s=ID) ---- */
  const id = new URLSearchParams(location.search).get('s');
  if (!id || !onWeb) return;

  const pwModal = $('#pwModal'), authModal = $('#authModal');
  const askPassword = (wrong) => new Promise((resolve) => {
    $('#pwErr').textContent = wrong ? 'Wrong password. Try again.' : ''; show('#pwErr', !!wrong);
    $('#pwInput').value = ''; pwModal.classList.remove('hidden'); $('#pwInput').focus();
    $('#pwForm').onsubmit = (e) => { e.preventDefault(); pwModal.classList.add('hidden'); resolve($('#pwInput').value); };
  });
  const askLogin = () => new Promise((resolve) => {
    authModal.classList.remove('hidden');
    $('#auBtn').onclick = async () => { if (await signIn()) { authModal.classList.add('hidden'); resolve(); } };
  });

  (async () => {
    try {
      toast('Opening shared docs…', 0);
      let password, res;
      for (;;) {
        res = await api('doc', { id, password });
        if (res.status === 401 && res.data.needsLogin) { await askLogin(); continue; }
        if (res.status === 401 && res.data.needsPassword) { password = await askPassword(res.data.wrong); continue; }
        break;
      }
      if (!res.ok) { toast(res.data.error || 'This link does not exist or has expired.', 0); return; }
      const { title, files, expiresAt } = res.data;
      document.body.classList.add('shared-view');
      await load(Object.entries(files).map(([path, text]) => ({ path, file: new File([text], path.slice(path.lastIndexOf('/') + 1), { type: 'text/markdown' }) })), title);
      const note = document.createElement('span'); note.className = 'shared-note hide-sm';
      note.textContent = `Shared with you · read-only · expires ${fmtDate(expiresAt)}`;
      $('#rootName').after(note);
    } catch {
      toast('Could not open this link. Check your connection and try again.', 0);
    }
  })();
})();
