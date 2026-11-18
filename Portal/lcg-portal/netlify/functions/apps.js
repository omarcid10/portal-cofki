const { ROLE_LEVEL } = require('./lib/auth');
const STATIC_APPS = require('./lib/apps');
const { getSession } = require('./lib/session');
const { rest } = require('./lib/supa');
const { accentFor, ROLE_LABEL } = require('./lib/roles');
const { json, safe } = require('./lib/http');

exports.handler = safe(async (event) => {
  const session = await getSession(event);
  if (!session) return json(401, { error: 'No autenticado' });

  // Sesión temporal por nivel: catálogo estático de lib/apps.js (comportamiento anterior)
  if (session.legacy) {
    const userLevel = ROLE_LEVEL[session.role] || 0;
    const visible = STATIC_APPS
      .filter((app) => {
        if (Array.isArray(app.onlyTiers)) return app.onlyTiers.includes(session.role);
        return (ROLE_LEVEL[app.minTier] || 0) <= userLevel;
      })
      .map((app) => ({ id: app.id, name: app.name, description: app.description, url: app.url, minTier: app.minTier }));
    return json(200, { role: session.role, roleLabel: session.role, legacy: true, isAdmin: session.role === 'socios', apps: visible });
  }

  // Sesión individual: catálogo en Supabase, filtrado por rol y sucursal
  const rows = await rest.select('portal_apps', 'estado=eq.disponible&order=orden.asc,nombre.asc');
  const esSocio = session.role === 'socios';
  const apps = rows
    .filter((a) => (a.roles_autorizados || []).includes(session.role))
    .filter((a) => {
      const suc = a.sucursales_autorizadas || [];
      if (!suc.length || esSocio) return true; // vacío = todas las sucursales; socios ven todas
      return suc.some((s) => (session.sucursales || []).includes(s));
    })
    .map((a) => ({ id: a.id, name: a.nombre, description: a.descripcion, url: a.url, minTier: accentFor(a.roles_autorizados) }));

  return json(200, {
    role: session.role,
    roleLabel: ROLE_LABEL[session.role] || session.role,
    nombre: session.nombre,
    sucursales: session.sucursales,
    legacy: false,
    isAdmin: esSocio,
    apps,
  });
});
