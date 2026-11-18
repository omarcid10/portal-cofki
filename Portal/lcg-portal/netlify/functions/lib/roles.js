// Roles del portal (Fase A). Ya no hay jerarquía automática: cada app lista
// explícitamente los roles que la ven (portal_apps.roles_autorizados).
const ROLES = ['socios', 'lideres', 'gerentes', 'supervisores', 'colaboradores', 'administrativos'];

const ROLE_LABEL = {
  socios: 'Socios',
  lideres: 'Líderes',
  gerentes: 'Gerentes',
  supervisores: 'Supervisores',
  colaboradores: 'Colaboradores',
  administrativos: 'Administrativos',
};

const ESTADOS = ['disponible', 'en_desarrollo', 'proximamente', 'inactiva'];

// Color de acento de la tarjeta (clases CSS que ya existen en portal.html)
function accentFor(roles) {
  const r = roles || [];
  if (r.includes('colaboradores') || r.includes('administrativos')) return 'equipo';
  if (r.includes('gerentes') || r.includes('supervisores')) return 'gerentes';
  if (r.includes('lideres')) return 'lideres';
  return 'socios';
}

module.exports = { ROLES, ROLE_LABEL, ESTADOS, accentFor };
