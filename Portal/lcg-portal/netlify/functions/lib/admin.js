const { getSession } = require('./session');
const { rest } = require('./supa');
const { json } = require('./http');

// Solo socios (con usuario individual, o con la contraseña de nivel mientras
// siga activa) pueden administrar. Devuelve { session, actor } o { error }.
async function requireSocio(event) {
  const session = await getSession(event);
  if (!session) return { error: json(401, { error: 'No autenticado' }) };
  if (session.role !== 'socios') return { error: json(403, { error: 'Esta sección es solo para socios.' }) };
  return { session, actor: session.legacy ? 'nivel:socios' : session.email };
}

async function audit(actor, accion, objetivo, detalle) {
  try {
    await rest.insert('portal_auditoria', { actor, accion, objetivo: objetivo || null, detalle: detalle || {} });
  } catch (e) {
    console.error('auditoría falló:', e.message); // no debe tumbar la operación principal
  }
}

module.exports = { requireSocio, audit };
