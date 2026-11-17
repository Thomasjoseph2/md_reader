// GET /api/auth/me -> { user: {id,email,name,picture} | null }
const { send } = require('../_lib');
const { currentUser } = require('../_auth');

module.exports = async (req, res) => {
  try { send(res, 200, { user: await currentUser(req) }); }
  catch (e) { console.error('me failed', e.message); send(res, 500, { error: 'Could not check sign-in.' }); }
};
