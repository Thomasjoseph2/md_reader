// POST /api/auth/logout
const { send, guardPost } = require('../_lib');
const { endSession } = require('../_auth');

module.exports = async (req, res) => {
  if (guardPost(req, res)) return;
  try { await endSession(req, res); send(res, 200, { ok: true }); }
  catch (e) { console.error('logout failed', e.message); send(res, 500, { error: 'Could not sign out.' }); }
};
