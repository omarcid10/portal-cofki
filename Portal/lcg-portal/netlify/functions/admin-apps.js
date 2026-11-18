const { rest, enc } = require('./lib/supa');
const { ROLES, ESTADOS } = require('./lib/roles');
const { requireSocio, audit } = require('./lib/admin');
const { json, parseBody, safe } = require('./lib/http');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

async function validar(b, validas, parcial) {
  const out = {};
  if (!parcial || b.nombre !== undefined) {
    const n = String(b.nombre || '').trim();
    if (!n) return { error: 'Falta el nombre' };
    out.nombre = n;
  }
  if (!parcial || b.descripcion !== undefined) out.descripcion = String(b.descripcion || '').trim();
  if (!parcial || b.url !== undefined) {
    const u = String(b.url || '').trim();
    if (!/^https:\/\/[^\s]+$/i.test(u)) return { error: 'La URL debe empezar con https://' };
    out.url = u;
  }
  if (!parcial || b.modulo !== undefined) out.modulo = b.modulo ? String(b.modulo).trim() : null;
  if (!parcial || b.icono !== undefined) out.icono = b.icono ? String(b.icono).trim() : null;
  if (!parcial || b.estado !== undefined) {
    const e = b.estado || 'disponible';
    if (!ESTADOS.includes(e)) return { error: 'Estado inválido' };
    out.estado = e;
  }
  if (!parcial || b.orden !== undefined) {
    const o = Number(b.orden === undefined || b.orden === '' ? 0 : b.orden);
    if (!Number.isInteger(o)) return { error: 'El orden debe ser un número entero' };
    out.orden = o;
  }
  if (!parcial || b.roles_autorizados !== undefined) {
    const r = Array.isArray(b.roles_autorizados) ? b.roles_autorizados : [];
    if (r.some((x) => !ROLES.includes(x))) return { error: 'Rol inválido en roles autorizados' };
    out.roles_autorizados = r;
  }
  if (!parcial || b.sucursales_autorizadas !== undefined) {
    const s = Array.isArray(b.sucursales_autorizadas) ? b.sucursales_autorizadas : [];
    if (s.some((x) => !validas.includes(x))) return { error: 'Sucursal inválida' };
    out.sucursales_autorizadas = s;
  }
  return { out };
}

exports.handler = safe(async (event) => {
  const gate = await requireSocio(event);
  if (gate.error) return gate.error;
  const { actor } = gate;
  const method = event.httpMethod;

  if (method === 'GET') {
    const [apps, sucursales] = await Promise.all([
      rest.select('portal_apps', 'order=orden.asc,nombre.asc'),
      rest.select('portal_sucursales', 'order=orden.asc'),
    ]);
    return json(200, { apps, sucursales, roles: ROLES, estados: ESTADOS });
  }

  const b = parseBody(event);
  if (!b) return json(400, { error: 'JSON inválido' });
  const validas = (await rest.select('portal_sucursales')).map((s) => s.codigo);

  if (method === 'POST') {
    const id = String(b.id || '').trim().toLowerCase();
    if (!SLUG_RE.test(id)) return json(400, { error: 'El identificador solo puede tener minúsculas, números y guiones (ej. solicitudes-compras)' });
    if ((await rest.select('portal_apps', `id=eq.${enc(id)}`)).length) return json(409, { error: 'Ya existe una app con ese identificador' });
    const v = await validar(b, validas, false);
    if (v.error) return json(400, { error: v.error });
    const app = await rest.insert('portal_apps', { id, ...v.out });
    await audit(actor, 'crear_app', id, { nombre: v.out.nombre, roles: v.out.roles_autorizados });
    return json(201, { app });
  }

  if (method === 'PUT') {
    if (!b.id) return json(400, { error: 'Falta el id' });
    if (!(await rest.select('portal_apps', `id=eq.${enc(b.id)}`)).length) return json(404, { error: 'App no encontrada' });
    const v = await validar(b, validas, true);
    if (v.error) return json(400, { error: v.error });
    if (!Object.keys(v.out).length) return json(400, { error: 'No hay cambios' });
    v.out.actualizado_en = new Date().toISOString();
    const app = await rest.patch('portal_apps', `id=eq.${enc(b.id)}`, v.out);
    await audit(actor, 'editar_app', b.id, v.out);
    return json(200, { app });
  }

  return json(405, { error: 'Método no permitido' });
});
