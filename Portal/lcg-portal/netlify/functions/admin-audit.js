const { rest } = require('./lib/supa');
const { requireSocio } = require('./lib/admin');
const { json, safe } = require('./lib/http');

exports.handler = safe(async (event) => {
  const gate = await requireSocio(event);
  if (gate.error) return gate.error;
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido' });
  const rows = await rest.select('portal_auditoria', 'order=id.desc&limit=100');
  return json(200, { eventos: rows });
});
