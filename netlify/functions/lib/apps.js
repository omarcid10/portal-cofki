// Catálogo de apps del portal.
// minTier: "socios" | "gerentes" | "equipo" — nivel MÍNIMO que puede verla.
// (socios ve todo, gerentes ve gerentes+equipo, equipo solo ve equipo)
//
// Para agregar una app nueva, copia un bloque y edítalo. Para quitar una, bórralo.

module.exports = [
  {
    id: 'inventarios-diarios',
    name: 'Inventarios Diarios',
    description: 'Captura de inventario móvil conectada a Google Sheets',
    url: 'https://cerulean-sawine-627994.netlify.app/',
    minTier: 'equipo',
  },
  {
    id: 'reservas',
    name: 'Administración de Reservas',
    description: 'Consulta y gestión de reservas de mesas',
    url: 'https://cofki-reservas-admin.netlify.app/',
    minTier: 'equipo',
  },
  {
    id: 'llegadas-hostess-pueblo-serena',
    name: 'Llegadas Hostess - Pueblo Serena',
    description: 'Registro de llegadas y lista de espera en Pueblo Serena',
    url: 'https://hostess-llegadas-cofkiserena.netlify.app/',
    minTier: 'equipo',
  },
  {
    id: 'entrevistas',
    name: 'Entrevistas',
    description: 'Gestión de entrevistas de contratación',
    url: 'https://entrevistascofki.netlify.app/',
    minTier: 'gerentes',
  },
  {
    id: 'auditorias-operativas',
    name: 'Auditorías Operativas',
    description: 'Checklist de supervisión operativa por sucursal',
    url: 'https://checklist-supervision-socio.netlify.app/',
    minTier: 'socios',
  },
];
