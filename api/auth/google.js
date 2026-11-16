// GET /api/auth/google?return=/path  ->  redirects to Google's sign-in page (authorization code + PKCE)
const crypto = require('crypto');
const { appUrl, randomToken } = require('../_lib');
const { setCookie } = require('../_auth');

module.exports = (req, res) => {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id || !process.env.GOOGLE_CLIENT_SECRET) { res.status(500).send('Google sign-in is not configured on the server.'); return; }
  const ret = String(req.query.return || '/');
  const safeRet = ret.startsWith('/') && !ret.startsWith('//') && !ret.includes('\\') ? ret : '/';
  const state = randomToken(16), verifier = randomToken(32);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  setCookie(req, res, 'mdv_oauth', Buffer.from(JSON.stringify({ state, verifier, ret: safeRet })).toString('base64url'), { maxAgeSec: 600 });
  const p = new URLSearchParams({
    client_id: id, redirect_uri: appUrl(req) + '/api/auth/callback', response_type: 'code', scope: 'openid email profile',
    state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, 'https://accounts.google.com/o/oauth2/v2/auth?' + p);
};
