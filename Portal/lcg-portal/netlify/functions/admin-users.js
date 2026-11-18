const { rest, auth, enc } = require('./lib/supa');
const { ROLES } = require('./lib/roles');
const { requireSocio, audit } = require('./lib/admin');
const { json, parseBody, safe } = require('./lib/http');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sucursalesValidas() {
  return (await rest.select('portal_sucursales', 'order=orden.asc')).map((s) => s.codigo);
}

function limpiarSucursales(input, validas) {
  const arr = Array.isArray(input) ? input : [];
  const bad = arr.filter((s) => !validas.includes(s));
  return { bad, list: arr.filter((s) => validas.includes(s)) };
}

async function otrosSociosActivos(excluirId) {
  const rows = await rest.select('portal_perfiles', 'rol=eq.socios&activo=eq.true');
  return rows.filter((p) => p.id !== excluirId).length;
}

exports.handler = safe(async (event) => {
  const gate = await requireSocio(event);
  if (gate.error) return gate.error;
  const { session, actor } = gate;
  const method = event.httpMethod;

  if (method === 'GET') {
    const [users, sucursales] = await Promise.all([
      rest.select('portal_perfiles', 'order=nombre.asc'),
      rest.select('portal_sucursales', 'order=orden.asc'),
    ]);
    return json(200, { users, sucursales, roles: ROLES, yo: session.legacy ? null : session.uid });
  }

  if (method === 'POST') {
    const b = parseBody(event);
    if (!b) return json(400, { error: 'JSON inválido' });
    const email = String(b.email || '').trim().toLowerCase();
    const nombre = String(b.nombre || '').trim();
    if (!EMAIL_RE.test(email)) return json(400, { error: 'Correo inválido' });
    if (!nombre) return json(400, { error: 'Falta el nombre' });
    if (!ROLES.includes(b.rol)) return json(400, { error: 'Rol inválido' });
    if (!b.password || String(b.password).length < 8) return json(400, { error: 'La contraseña debe tener mínimo 8 caracteres' });
    const { bad, list } = limpiarSucursales(b.sucursales, await sucursalesValidas());
    if (bad.length) return json(400, { error: 'Sucursal inválida: ' + bad.join(', ') });

    const ya = await rest.select('portal_perfiles', `email=eq.${enc(email)}`);
    if (ya.length) return json(409, { error: 'Ese correo ya tiene acceso al portal.' });

    let created = await auth.createUser(email, String(b.password));
    let vinculado = false;
    if (created.existed) {
      // El correo ya existe en Supabase (lo usa otra app): se vincula sin tocar su contraseña.
      const id = await auth.findIdByEmail(email);
      if (!id) return json(409, { error: 'Ese correo ya existe en Supabase pero no pude vincularlo. Revisa que el SQL de la Fase A se haya ejecutado completo.' });
      created = { id, existed: true };
      vinculado = true;
    }

    let perfil;
    try {
      perfil = await rest.insert('portal_perfiles', { id: created.id, email, nombre, rol: b.rol, sucursales: list, activo: true, vinculado });
    } catch (e) {
      if (!vinculado) { try { await auth.deleteUser(created.id); } catch (_) { /* mejor esfuerzo */ } }
      throw e;
    }
    await audit(actor, 'crear_usuario', email, { rol: b.rol, sucursales: list, vinculado });
    return json(201, { user: perfil, vinculado });
  }

  if (method === 'PATCH') {
    const b = parseBody(event);
    if (!b || !b.id) return json(400, { error: 'Falta el id' });
    const target = (await rest.select('portal_perfiles', `id=eq.${enc(b.id)}`))[0];
    if (!target) return json(404, { error: 'Usuario no encontrado' });

    const patch = {};
    const cambios = {};
    if (b.nombre !== undefined) {
      const n = String(b.nombre).trim();
      if (!n) return json(400, { error: 'El nombre no puede estar vacío' });
      patch.nombre = n; cambios.nombre = n;
    }
    if (b.rol !== undefined) {
      if (!ROLES.includes(b.rol)) return json(400, { error: 'Rol inválido' });
      patch.rol = b.rol; cambios.rol = b.rol;
    }
    if (b.sucursales !== undefined) {
      const { bad, list } = limpiarSucursales(b.sucursales, await sucursalesValidas());
      if (bad.length) return json(400, { error: 'Sucursal inválida: ' + bad.join(', ') });
      patch.sucursales = list; cambios.sucursales = list;
    }
    if (b.activo !== undefined) {
      if (typeof b.activo !== 'boolean') return json(400, { error: 'Valor inválido para activo' });
      patch.activo = b.activo; cambios.activo = b.activo;
    }

    const esYo = !session.legacy && session.uid === target.id;
    const pierdeSocio = target.rol === 'socios' && target.activo &&
      ((patch.rol !== undefined && patch.rol !== 'socios') || patch.activo === false);
    if (pierdeSocio) {
      if (esYo) return json(400, { error: 'No puedes quitarte a ti mismo el acceso de socio.' });
      if ((await otrosSociosActivos(target.id)) < 1) return json(400, { error: 'Debe quedar al menos un socio activo.' });
    }
    if (esYo && patch.activo === false) return json(400, { error: 'No puedes desactivarte a ti mismo.' });

    if (b.password !== undefined && b.password !== '') {
      if (String(b.password).length < 8) return json(400, { error: 'La contraseña debe tener mínimo 8 caracteres' });
      await auth.updateUser(target.id, { password: String(b.password) });
      cambios.password = 'restablecida';
    }

    let user = target;
    if (Object.keys(patch).length) {
      patch.actualizado_en = new Date().toISOString();
      user = await rest.patch('portal_perfiles', `id=eq.${enc(target.id)}`, patch);
    }
    if (!Object.keys(cambios).length) return json(400, { error: 'No hay cambios' });
    await audit(actor, 'editar_usuario', target.email, cambios);
    return json(200, { user });
  }

  if (method === 'DELETE') {
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { error: 'Falta el id' });
    const target = (await rest.select('portal_perfiles', `id=eq.${enc(id)}`))[0];
    if (!target) return json(404, { error: 'Usuario no encontrado' });
    if (!session.legacy && session.uid === target.id) return json(400, { error: 'No puedes eliminarte a ti mismo.' });
    if (target.rol === 'socios' && target.activo && (await otrosSociosActivos(target.id)) < 1) {
      return json(400, { error: 'Debe quedar al menos un socio activo.' });
    }
    if (target.vinculado) {
      // Usuario compartido con otras apps: solo se le quita el acceso al portal.
      await rest.remove('portal_perfiles', `id=eq.${enc(target.id)}`);
    } else {
      await auth.deleteUser(target.id); // borra también el perfil (ON DELETE CASCADE)
      const resto = await rest.select('portal_perfiles', `id=eq.${enc(target.id)}`);
      if (resto.length) await rest.remove('portal_perfiles', `id=eq.${enc(target.id)}`);
    }
    await audit(actor, 'eliminar_usuario', target.email, { vinculado: !!target.vinculado });
    return json(200, { ok: true, soloPortal: !!target.vinculado });
  }

  return json(405, { error: 'Método no permitido' });
});
