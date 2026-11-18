const { auth } = require('./lib/supa');
const { getSession } = require('./lib/session');
const { audit } = require('./lib/admin');
const { json, parseBody, safe } = require('./lib/http');

// Cambio de contraseña propio (usuarios individuales). Pide la actual.
exports.handler = safe(async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  const session = await getSession(event);
  if (!session) return json(401, { error: 'No autenticado' });
  if (session.legacy) return json(403, { error: 'Entra con tu correo para cambiar tu contraseña.' });

  const b = parseBody(event);
  if (!b || !b.actual || !b.nueva) return json(400, { error: 'Faltan datos' });
  if (String(b.nueva).length < 8) return json(400, { error: 'La nueva contraseña debe tener mínimo 8 caracteres' });

  const ok = await auth.signIn(session.email, String(b.actual));
  if (!ok || ok.id !== session.uid) return json(400, { error: 'La contraseña actual no es correcta' });

  await auth.updateUser(session.uid, { password: String(b.nueva) });
  await audit(session.email, 'cambiar_contrasena_propia', session.email, {});
  return json(200, { ok: true });
});
