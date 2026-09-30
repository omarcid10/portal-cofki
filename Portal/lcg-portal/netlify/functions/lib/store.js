const { getStore } = require('@netlify/blobs');
const { hashPassword } = require('./auth');

const DEFAULTS = {
  socios: process.env.DEFAULT_PW_SOCIOS || 'Cambiar-Socios-2026',
  gerentes: process.env.DEFAULT_PW_GERENTES || 'Cambiar-Gerentes-2026',
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
  if (raw) return raw;

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
