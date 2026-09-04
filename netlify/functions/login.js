const { ROLE_LEVEL, sign, verifyPassword } = require('./lib/auth');
const { getConfig } = require('./lib/store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { password } = body;
  if (!password) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta la contraseña' }) };
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar SESSION_SECRET en Netlify' }) };
  }

  const config = await getConfig();
  let matchedRole = null;
  for (const role of Object.keys(ROLE_LEVEL)) {
    const entry = config[role];
    if (entry && verifyPassword(password, entry.salt, entry.hash)) {
      matchedRole = role;
      break;
    }
  }

  if (!matchedRole) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Contraseña incorrecta' }) };
  }

  const token = sign({ role: matchedRole, exp: Date.now() + 1000 * 60 * 60 * 12 }, secret);

  return {
    statusCode: 200,
    headers: {
      'Set-Cookie': `lcg_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: matchedRole }),
  };
};
