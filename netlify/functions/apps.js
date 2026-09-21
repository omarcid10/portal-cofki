const { ROLE_LEVEL, verify, parseCookies } = require('./lib/auth');
const APPS = require('./lib/apps');

exports.handler = async (event) => {
  const cookies = parseCookies(event.headers.cookie);
  const secret = process.env.SESSION_SECRET;
  const session = verify(cookies.lcg_session, secret);

  if (!session) {
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No autenticado' }) };
  }

  const userLevel = ROLE_LEVEL[session.role] || 0;
  const visible = APPS
    .filter((app) => (ROLE_LEVEL[app.minTier] || 0) <= userLevel)
    .map((app) => ({ id: app.id, name: app.name, description: app.description, url: app.url, minTier: app.minTier }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: session.role, apps: visible }),
  };
};
