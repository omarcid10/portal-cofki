const { ROLE_LEVEL, verify, parseCookies, hashPassword } = require('./lib/auth');
const { getConfig, saveConfig } = require('./lib/store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const cookies = parseCookies(event.headers.cookie);
  const secret = process.env.SESSION_SECRET;
  const session = verify(cookies.lcg_session, secret);

  if (!session || session.role !== 'socios') {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No autorizado. Solo socios puede cambiar contraseñas.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { tier, newPassword } = body;
  if (!ROLE_LEVEL[tier] || !newPassword || newPassword.length < 8) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Datos inválidos: la contraseña debe tener mínimo 8 caracteres' }) };
  }

  const config = await getConfig();
  const { salt, hash } = hashPassword(newPassword);
  config[tier] = { salt, hash, updatedAt: new Date().toISOString() };
  await saveConfig(config);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, tier, updatedAt: config[tier].updatedAt }),
  };
};
