// GET /api/auth/callback  <- Google sends the user back here with ?code=&state=
const repo = require('../_repo');
const { appUrl } = require('../_lib');
const { parseCookies, setCookie, startSession } = require('../_auth');

const page = (res, code, title, body, script = '') => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  res.status(code).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:0 20px;color:#2a2d34"><h2>${title}</h2><p>${body}</p><p><a href="/">Back to the viewer</a></p>${script}</body>`);
};

module.exports = async (req, res) => {
  try {
    const raw = parseCookies(req).mdv_oauth;
    setCookie(req, res, 'mdv_oauth', '', { maxAgeSec: 0 });
    let saved; try { saved = JSON.parse(Buffer.from(raw || '', 'base64url').toString()); } catch {}
    if (req.query.error) return page(res, 400, 'Sign-in cancelled', 'You did not finish signing in with Google.');
    if (!saved || !req.query.code || req.query.state !== saved.state) return page(res, 400, 'Sign-in expired', 'Please close this and try signing in again.');

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: appUrl(req) + '/api/auth/callback', grant_type: 'authorization_code', code_verifier: saved.verifier,
      }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) { console.error('google token exchange failed', tok.error); return page(res, 400, 'Sign-in failed', 'Google did not accept the sign-in. Please try again.'); }
    // The id_token came straight from Google over TLS in exchange for our secret, so it is trusted; still check the claims.
    const c = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString());
    const okIss = c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com';
    if (!okIss || c.aud !== process.env.GOOGLE_CLIENT_ID || c.exp * 1000 < Date.now() || !c.email || c.email_verified !== true) {
      return page(res, 400, 'Sign-in failed', 'Your Google email could not be verified.');
    }
    const user = await repo.users.upsertGoogle({ sub: c.sub, email: c.email.toLowerCase(), name: c.name, picture: c.picture });
    await startSession(req, res, user.id);
    repo.housekeeping.purge().catch(() => {});

    const ret = JSON.stringify(saved.ret).replace(/</g, '\\u003c');
    // Popup: tell the page that opened it (Google's pages sever window.opener, so use a same-origin channel) and close.
    // Full-page sign-in: just go back where the user was.
    const popupJs = `try{new BroadcastChannel('mdv-auth').postMessage('done')}catch(e){}try{window.opener&&window.opener.postMessage({mdvAuth:true},location.origin)}catch(e){}window.close()`;
    page(res, 200, 'Signed in', 'You can close this window and go back to the viewer.',
      `<script>${saved.popup ? popupJs : `location.replace(${ret})`}</script>`);
  } catch (e) {
    console.error('callback failed', e.message);
    page(res, 500, 'Something went wrong', 'Please try again.');
  }
};
