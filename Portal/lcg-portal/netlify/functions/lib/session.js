const { verify, parseCookies } = require('./auth');
const { configured, rest, enc } = require('./supa');

// LEGACY_LOGIN=off en Netlify desactiva el acceso por contraseña de nivel
// (y cierra de inmediato las sesiones de ese tipo).
function legacyEnabled() {
  return String(process.env.LEGACY_LOGIN || '').toLowerCase() !== 'off';
}

// Devuelve la sesión vigente o null. Para usuarios individuales (v2) consulta
// Supabase en cada petición: si un socio desactiva o elimina a alguien, pierde
// el acceso al instante aunque su cookie siga vigente.
async function getSession(event) {
  const cookies = parseCookies(event.headers && (event.headers.cookie || event.headers.Cookie));
  const payload = verify(cookies.lcg_session, process.env.SESSION_SECRET);
  if (!payload) return null;

  if (payload.v === 2) {
    if (!configured()) return null;
    const rows = await rest.select('portal_perfiles', `id=eq.${enc(payload.uid)}`);
    const p = rows[0];
    if (!p || !p.activo) return null;
    return { legacy: false, uid: p.id, email: p.email, nombre: p.nombre, role: p.rol, sucursales: p.sucursales || [], perfil: p };
  }

  if (!legacyEnabled()) return null;
  return { legacy: true, role: payload.role };
}

module.exports = { getSession, legacyEnabled };
