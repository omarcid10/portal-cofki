// Cliente mínimo de Supabase (solo servidor). Usa SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY de las variables de entorno de Netlify.
// La llave service_role NUNCA debe llegar al navegador ni al repositorio.
const enc = encodeURIComponent;

function cfg() {
  return {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    anon: process.env.SUPABASE_ANON_KEY || '',
  };
}

function configured() {
  const { url, key } = cfg();
  return !!(url && key);
}

async function call(path, { method = 'GET', body, prefer, headers } = {}) {
  const { url, key } = cfg();
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(headers || {}) };
  if (prefer) h.Prefer = prefer;
  const res = await fetch(url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function fail(r, what) {
  const msg = (r.data && (r.data.msg || r.data.message || r.data.error_description || r.data.error)) || 'error';
  const e = new Error(`Supabase ${what} (${r.status}): ${msg}`);
  e.status = r.status;
  e.code = r.data && (r.data.error_code || r.data.code);
  return e;
}

const rest = {
  async select(table, filters = '') {
    const r = await call(`/rest/v1/${table}?select=*${filters ? '&' + filters : ''}`);
    if (!r.ok) throw fail(r, `select ${table}`);
    return r.data || [];
  },
  async insert(table, row) {
    const r = await call(`/rest/v1/${table}`, { method: 'POST', body: row, prefer: 'return=representation' });
    if (!r.ok) throw fail(r, `insert ${table}`);
    return Array.isArray(r.data) ? r.data[0] : r.data;
  },
  async patch(table, filter, patch) {
    const r = await call(`/rest/v1/${table}?${filter}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    if (!r.ok) throw fail(r, `update ${table}`);
    return Array.isArray(r.data) ? r.data[0] : r.data;
  },
  async remove(table, filter) {
    const r = await call(`/rest/v1/${table}?${filter}`, { method: 'DELETE' });
    if (!r.ok) throw fail(r, `delete ${table}`);
  },
};

const auth = {
  // Valida correo + contraseña. Devuelve { id, email } o null si son incorrectos.
  async signIn(email, password) {
    const { url, key, anon } = cfg();
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anon || key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 400 || res.status === 401 || res.status === 422) return null;
    if (!res.ok) throw new Error(`Supabase auth (${res.status})`);
    const data = await res.json();
    return data && data.user ? { id: data.user.id, email: data.user.email } : null;
  },
  async createUser(email, password) {
    const r = await call('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } });
    if (r.ok) return { id: r.data.id, existed: false };
    const code = r.data && (r.data.error_code || r.data.code);
    if (r.status === 422 && (code === 'email_exists' || code === 'user_already_exists')) return { id: null, existed: true };
    throw fail(r, 'crear usuario');
  },
  async updateUser(id, patch) {
    const r = await call(`/auth/v1/admin/users/${enc(id)}`, { method: 'PUT', body: patch });
    if (!r.ok) throw fail(r, 'actualizar usuario');
  },
  async deleteUser(id) {
    const r = await call(`/auth/v1/admin/users/${enc(id)}`, { method: 'DELETE' });
    if (!r.ok) throw fail(r, 'eliminar usuario');
  },
  // Busca un usuario ya existente en Supabase (de otras apps) por correo.
  async findIdByEmail(email) {
    const r = await call('/rest/v1/rpc/portal_buscar_usuario', { method: 'POST', body: { p_email: email } });
    if (!r.ok) throw fail(r, 'buscar usuario');
    return r.data || null;
  },
};

module.exports = { configured, rest, auth, enc };
