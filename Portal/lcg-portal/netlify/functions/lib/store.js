const { getStore } = require('@netlify/blobs');
const { hashPassword } = require('./auth');

const DEFAULTS = {
  socios: process.env.DEFAULT_PW_SOCIOS || 'Cambiar-Socios-2026',
  gerentes: process.env.DEFAULT_PW_GERENTES || 'Cambiar-Gerentes-2026',
  lideres: process.env.DEFAULT_PW_LIDERES || 'Cambiar-Lideres-2026',
  equipo: process.env.DEFAULT_PW_EQUIPO || 'Cambiar-Equipo-2026',
};

function blobStore() {
  return getStore({
    name: 'lcg-portal-config',
    siteID: process.env.BLOBS_SITE_ID,
    token: process.env.BLOBS_TOKEN,
  });
}

async function getConfig() {
  const store = blobStore();
  const raw = await store.get('passwords', { type: 'json' });
  if (raw) {
    // Si se agregó un nivel nuevo (ej. lideres), se crea sin tocar las contraseñas existentes.
    // Sin DEFAULT_PW_<NIVEL> se usa una contraseña ALEATORIA: nadie entra hasta que
    // un socio la defina en /admin.html.
    let changed = false;
    for (const tier of Object.keys(DEFAULTS)) {
      if (!raw[tier]) {
        const envPw = process.env['DEFAULT_PW_' + tier.toUpperCase()];
        const pw = envPw || require('crypto').randomBytes(24).toString('hex');
        const { salt, hash } = hashPassword(pw);
        raw[tier] = { salt, hash, updatedAt: new Date().toISOString() };
        changed = true;
      }
    }
    if (changed) await store.setJSON('passwords', raw);
    return raw;
  }

  // Primera vez que corre: crea las contraseñas por defecto (¡cámbialas en /admin.html!)
  const config = {};
  for (const tier of Object.keys(DEFAULTS)) {
    const { salt, hash } = hashPassword(DEFAULTS[tier]);
    config[tier] = { salt, hash, updatedAt: new Date().toISOString() };
  }
  await store.setJSON('passwords', config);
  return config;
}

async function saveConfig(config) {
  const store = blobStore();
  await store.setJSON('passwords', config);
}

module.exports = { getConfig, saveConfig, DEFAULTS };
