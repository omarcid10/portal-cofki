const { ROLE_LEVEL, sign, verifyPassword } = require('./lib/auth');
const { getConfig } = require('./lib/store');
const { configured, rest, auth, enc } = require('./lib/supa');
const { legacyEnabled } = require('./lib/session');
const { safe } = require('./lib/http');

const COOKIE = (token) => `lcg_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
const BAD = { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Correo o contraseña incorrectos' }) };

// Acceso individual: correo + contraseña validados en Supabase Auth.
async function loginUsuario(email, password, secret) {
  if (!configured()) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Netlify' }) };
  }
  const user = await auth.signIn(String(email).trim().toLowerCase(), password);
  if (!user) return BAD;
  // Debe tener perfil activo en el portal; si no, mismo mensaje (no revela si el correo existe).
  const rows = await rest.select('portal_perfiles', `id=eq.${enc(user.id)}`);
  const perfil = rows[0];
  if (!perfil || !perfil.activo) return BAD;

  const token = sign({ v: 2, uid: perfil.id, exp: Date.now() + 1000 * 60 * 60 * 12 }, secret);
  return {
    statusCode: 200,
    headers: { 'Set-Cookie': COOKIE(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, role: perfil.rol }),
  };
}

exports.handler = safe(async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { password, email } = body;
  if (!password) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta la contraseña' }) };
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar SESSION_SECRET en Netlify' }) };
  }

  if (email) return loginUsuario(email, password, secret);

  // Acceso temporal por contraseña de nivel (se desactiva con LEGACY_LOGIN=off)
  if (!legacyEnabled()) {
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'El acceso por contraseña de nivel está desactivado. Entra con tu correo.' }) };
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
});
