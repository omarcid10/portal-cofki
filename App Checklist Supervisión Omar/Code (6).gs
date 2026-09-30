/**
 * COFKI CHECKLIST OPERATIVO — Backend (v3)
 * Google Apps Script + Google Sheets
 *
 * MODELO DE ACCESO (v3) — 3 niveles
 * ----------------------------------
 * 1) PISO (sin login): cualquiera abre la app, elige su sucursal, y llena
 *    checklists escribiendo su nombre (no hay usuario/password). Al enviar,
 *    el encargado o subgerente en turno revisa ahí mismo, escribe su nombre
 *    como validación y lo envía — igual que firmar un checklist de papel.
 * 2) LÍDER (con login): cuenta con usuario/password. Ve el avance de las
 *    3 sucursales (solo lectura) — dashboard, detalle, histórico.
 * 3) ADMIN / DIRECCIÓN (con login): todo lo del líder, más: administrar
 *    usuarios (crear/quitar líderes), y aprobar/devolver de forma remota
 *    como respaldo si nadie validó en sitio.
 *
 * Por diseño, las acciones de captura de piso (crear/llenar/enviar un
 * checklist, subir fotos, caja, validar en sitio) NO requieren token —
 * así el colaborador nunca tiene que iniciar sesión. Las acciones de
 * administración y los tableros de las 3 sucursales sí requieren login.
 *
 * INSTALACIÓN NUEVA: correr setup() una sola vez.
 * INSTALACIÓN QUE YA TENÍA UNA VERSIÓN ANTERIOR: correr upgradeToV3() una
 * sola vez (agrega columnas/hojas faltantes sin borrar nada), y correr
 * migrarRolesV3() para convertir cualquier usuario 'gerente' en 'lider'.
 */

// ============================================================
// CONFIG
// ============================================================
var SESSION_HOURS = 16;
var SALT_BYTES = 16;
var TIMEZONE = 'America/Monterrey';

var SHEETS = {
  SUCURSALES: 'Sucursales',
  AREAS: 'Areas',
  USUARIOS: 'Usuarios',
  SESIONES: 'Sesiones',
  CHECKLISTS: 'Checklists',
  ITEMS: 'ChecklistItems',
  RESPUESTAS: 'Respuestas',
  RESP_ITEMS: 'RespuestaItems',
  INCIDENCIAS: 'Incidencias',
  FOTOS: 'Fotos',
  CAJA: 'CajaCierre',
  INVENTARIO: 'InventarioCierre',
  AGUA: 'LecturasAgua'
};

var AREA_SERVICIO = 'AREA-SERV';
var AREA_CAJA = 'AREA-CAJA';
var SUCURSAL_CODIGO_AGUA = 'AURORA';

// ============================================================
// SETUP — instalación nueva
// ============================================================
function setup() { setup_(); }

function setup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  createSheetIfMissing_(ss, SHEETS.SUCURSALES, ['id', 'nombre', 'codigo', 'activa']);
  createSheetIfMissing_(ss, SHEETS.AREAS, ['id', 'nombre', 'codigo', 'activa']);
  createSheetIfMissing_(ss, SHEETS.USUARIOS, ['id', 'nombre', 'usuario', 'password_hash', 'salt', 'rol', 'sucursal_id', 'areas', 'activo', 'fecha_creacion']);
  createSheetIfMissing_(ss, SHEETS.SESIONES, ['token', 'usuario_id', 'creado', 'expira']);
  createSheetIfMissing_(ss, SHEETS.CHECKLISTS, ['id', 'area_id', 'tipo', 'nombre', 'activo']);
  createSheetIfMissing_(ss, SHEETS.ITEMS, ['id', 'checklist_id', 'orden', 'texto', 'requiere_foto', 'evidencia_tag', 'activo']);
  createSheetIfMissing_(ss, SHEETS.RESPUESTAS, respuestasHeaders_());
  createSheetIfMissing_(ss, SHEETS.RESP_ITEMS, ['id', 'respuesta_id', 'item_id', 'estado', 'nota', 'actualizado_at', 'actualizado_por']);
  createSheetIfMissing_(ss, SHEETS.INCIDENCIAS, ['id', 'respuesta_id', 'item_id', 'sucursal_id', 'area_id', 'texto', 'foto_url', 'estado', 'creado_por', 'creado_at']);
  createSheetIfMissing_(ss, SHEETS.FOTOS, ['id', 'respuesta_id', 'tipo_evidencia', 'sucursal_id', 'area_id', 'usuario_id', 'fecha', 'hora', 'drive_url', 'creado_at']);
  createSheetIfMissing_(ss, SHEETS.CAJA, ['id', 'sucursal_id', 'fecha', 'respuesta_id', 'diferencia', 'monto', 'explicacion', 'foto_arqueo_url', 'fotos_terminal_urls', 'estado', 'aprobado', 'aprobado_por', 'aprobado_at', 'comentario', 'usuario_id', 'creado_at']);
  createSheetIfMissing_(ss, SHEETS.INVENTARIO, ['id', 'sucursal_id', 'fecha', 'enviado', 'motivo', 'usuario_id', 'modulo_origen', 'creado_at']);
  createSheetIfMissing_(ss, SHEETS.AGUA, ['id', 'sucursal_id', 'fecha', 'lectura', 'foto_url', 'usuario_id', 'hora', 'consumo', 'creado_at']);

  seedSucursalesYAreas_();
  seedChecklistsFull_();
  seedAdminUser_();
  arreglarFormatoFechas();

  Logger.log('Setup completo. Usuario admin inicial en la hoja "Usuarios" -> cambialo desde la app.');
}

function respuestasHeaders_() {
  return ['id', 'sucursal_id', 'area_id', 'tipo', 'fecha', 'usuario_id', 'capturado_por_nombre',
    'estado', 'pct', 'tiene_incidencia',
    'enviado', 'enviado_at', 'aprobado', 'aprobado_por', 'aprobado_at', 'comentario_aprobacion',
    'validado_por_nombre', 'devuelto', 'motivo_devolucion', 'inventario_enviado', 'inventario_motivo',
    'medidor_lectura', 'medidor_foto_url', 'creado_at', 'actualizado_at'];
}

// ============================================================
// UPGRADE — para instalaciones de una versión anterior
// ============================================================
function upgradeToV3() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  createSheetIfMissing_(ss, SHEETS.RESPUESTAS, respuestasHeaders_());
  createSheetIfMissing_(ss, SHEETS.RESP_ITEMS, ['id', 'respuesta_id', 'item_id', 'estado', 'nota', 'actualizado_at', 'actualizado_por']);
  createSheetIfMissing_(ss, SHEETS.INCIDENCIAS, ['id', 'respuesta_id', 'item_id', 'sucursal_id', 'area_id', 'texto', 'foto_url', 'estado', 'creado_por', 'creado_at']);
  createSheetIfMissing_(ss, SHEETS.FOTOS, ['id', 'respuesta_id', 'tipo_evidencia', 'sucursal_id', 'area_id', 'usuario_id', 'fecha', 'hora', 'drive_url', 'creado_at']);
  createSheetIfMissing_(ss, SHEETS.CAJA, ['id', 'sucursal_id', 'fecha', 'respuesta_id', 'diferencia', 'monto', 'explicacion', 'foto_arqueo_url', 'fotos_terminal_urls', 'estado', 'aprobado', 'aprobado_por', 'aprobado_at', 'comentario', 'usuario_id', 'creado_at']);
  createSheetIfMissing_(ss, SHEETS.INVENTARIO, ['id', 'sucursal_id', 'fecha', 'enviado', 'motivo', 'usuario_id', 'modulo_origen', 'creado_at']);
  createSheetIfMissing_(ss, SHEETS.AGUA, ['id', 'sucursal_id', 'fecha', 'lectura', 'foto_url', 'usuario_id', 'hora', 'consumo', 'creado_at']);
  arreglarFormatoFechas();
  agregarColumnasV3();
  Logger.log('Hojas al día. Corre tambien migrarRolesV3() para pasar usuarios "gerente" a "lider". Si tus checklists solo tienen los items de ejemplo, corre resetChecklistItems().');
}

// Agrega a la hoja Respuestas las columnas nuevas de la v3 sin tocar las
// filas existentes (las celdas nuevas quedan en blanco en filas viejas).
function agregarColumnasV3() {
  var sh = getSheet_(SHEETS.RESPUESTAS);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var faltantes = ['capturado_por_nombre', 'validado_por_nombre'].filter(function (h) { return headers.indexOf(h) === -1; });
  faltantes.forEach(function (h) { sh.getRange(1, sh.getLastColumn() + 1).setValue(h); });
  Logger.log(faltantes.length ? ('Columnas agregadas a Respuestas: ' + faltantes.join(', ')) : 'Respuestas ya tenía las columnas de la v3.');
}

// Convierte cualquier usuario con rol 'gerente' (de versiones anteriores)
// a 'lider'. Los colaboradores ya no necesitan cuenta — el piso ahora es
// sin login — así que puedes desactivar esas cuentas si quieres (no hace
// falta borrarlas).
function migrarRolesV3() {
  var cambiados = 0;
  getAll_(SHEETS.USUARIOS).forEach(function (u) {
    if (u.rol === 'gerente') {
      updateRowByField_(SHEETS.USUARIOS, 'id', u.id, { rol: 'lider' });
      cambiados++;
    }
  });
  Logger.log('Roles migrados: ' + cambiados + ' usuario(s) gerente -> lider.');
}

// ⚠️ DESTRUCTIVO: borra todos los ítems/checklists actuales y los reemplaza
// por los checklists reales de Cofki.
function resetChecklistItems() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var clSheet = ss.getSheetByName(SHEETS.CHECKLISTS);
  var itemSheet = ss.getSheetByName(SHEETS.ITEMS);
  if (clSheet.getLastRow() > 1) clSheet.getRange(2, 1, clSheet.getLastRow() - 1, clSheet.getLastColumn()).clearContent();
  if (itemSheet.getLastRow() > 1) itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, itemSheet.getLastColumn()).clearContent();
  writeChecklistDefinitions_();
  Logger.log('Checklists reemplazados con la version completa de Cofki.');
}

function createSheetIfMissing_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
}

// ============================================================
// SEEDS
// ============================================================
function seedSucursalesYAreas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sucSheet = ss.getSheetByName(SHEETS.SUCURSALES);
  if (sucSheet.getLastRow() === 1) {
    sucSheet.getRange(2, 1, 3, 4).setValues([
      ['SUC-GM3', 'Gómez Morin (GM3)', 'GM3', true],
      ['SUC-AUR', 'La Aurora', 'AURORA', true],
      ['SUC-PSE', 'Pueblo Serena', 'PSERENA', true]
    ]);
  }

  var areaSheet = ss.getSheetByName(SHEETS.AREAS);
  if (areaSheet.getLastRow() === 1) {
    areaSheet.getRange(2, 1, 5, 4).setValues([
      ['AREA-SERV', 'Servicio / Salón', 'SERVICIO', true],
      ['AREA-NANI', 'Nannies', 'NANNIES', true],
      ['AREA-BARRA', 'Barra', 'BARRA', true],
      ['AREA-COCI', 'Cocina', 'COCINA', true],
      ['AREA-CAJA', 'Caja', 'CAJA', true]
    ]);
  }
}

function seedAdminUser_() {
  var usersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.USUARIOS);
  if (usersSheet.getLastRow() > 1) return;
  var salt = generateSalt_();
  var tempPassword = 'cofki2026';
  var hash = hashPassword_(tempPassword, salt);
  usersSheet.appendRow(['U-1', 'Omar Cid', 'omar.cid', hash, salt, 'admin', '', '', true, new Date()]);
  Logger.log('Usuario admin -> omar.cid / ' + tempPassword);
}

// Utilidad para crear cuentas de LÍDER o ADMIN desde el editor (además de
// la pantalla "Administrar equipo" dentro de la app, que también sirve
// para esto). El piso (colaboradores/encargados) YA NO necesita cuentas.
function crearUsuarioManual() {
  var nombre = 'Líder Prueba';
  var usuario = 'lider.prueba';
  var password = 'cofki2026';
  var rol = 'lider'; // 'lider' | 'admin'
  var sucursalId = ''; // los líderes/admin ven las 3, no hace falta asignar sucursal

  var existentes = getAll_(SHEETS.USUARIOS);
  if (existentes.some(function (u) { return (u.usuario || '').toLowerCase() === usuario.toLowerCase(); })) {
    Logger.log('Ese usuario ya existe: ' + usuario);
    return;
  }
  var salt = generateSalt_();
  var hash = hashPassword_(password, salt);
  var id = 'U-' + Utilities.getUuid().slice(0, 8);
  getSheet_(SHEETS.USUARIOS).appendRow([id, nombre, usuario, hash, salt, rol, sucursalId, '', true, new Date()]);
  Logger.log('Usuario creado -> ' + usuario + ' / ' + password + ' (rol: ' + rol + ')');
}

// Definición completa de checklists operativos de Cofki.
function checklistDefinitions_() {
  return [
    { area_id: 'AREA-SERV', tipo: 'apertura', nombre: 'Servicio / Salón — Apertura', items: [
      ['Encender luces del salón', null],
      ['Encender aire acondicionado / climatizar a temperatura de confort', null],
      ['Encender música ambiental', null],
      ['Revisar limpieza de mesas y sillas', null],
      ['Revisar limpieza de piso del salón', null],
      ['Verificar baños limpios y con insumos (papel, jabón, gel)', null],
      ['Revisar exterior / fachada libre de basura', null],
      ['Verificar que puertas y accesos abran correctamente', null],
      ['Revisar uniforme e higiene personal del equipo de salón', null],
      ['Confirmar estaciones de servicio surtidas (servilletas, cubiertos, condimentos)', null],
      ['Revisar menús y señalización en buen estado', null]
    ]},
    { area_id: 'AREA-SERV', tipo: 'cierre', nombre: 'Servicio / Salón — Cierre', items: [
      ['Limpieza profunda de mesas, sillas y piso del salón', null],
      ['Limpieza y desinfección del área infantil', null],
      ['Limpieza de baños', 'banos'],
      ['Limpieza de exterior / fachada', 'exterior'],
      ['Revisión y orden de estaciones de servicio', null],
      ['Apagar luces no esenciales', null],
      ['Apagar / ajustar aire acondicionado', null],
      ['Apagar música / equipo de audio', null],
      ['Verificar cierre correcto de puertas y accesos', null],
      ['Revisar y registrar objetos olvidados por clientes', null],
      ['Foto general del salón limpio y ordenado', 'salon']
    ]},
    { area_id: 'AREA-NANI', tipo: 'apertura', nombre: 'Nannies — Apertura', items: [
      ['Revisar limpieza y desinfección del área infantil', null],
      ['Verificar seguridad del área (protecciones, sin objetos peligrosos)', null],
      ['Revisar juguetes disponibles y en buen estado', null],
      ['Verificar materiales didácticos / de arte disponibles', null],
      ['Confirmar playdates o eventos programados para hoy', null],
      ['Revisar uniforme e higiene de las nannies', null],
      ['Verificar botiquín de primeros auxilios completo', null]
    ]},
    { area_id: 'AREA-NANI', tipo: 'cierre', nombre: 'Nannies — Cierre', items: [
      ['Recoger y ordenar juguetes por categoría', null],
      ['Desinfectar juguetes de uso común', null],
      ['Limpieza y desinfección de superficies del área infantil', null],
      ['Revisar materiales usados en playdates / eventos y reponer faltantes', null],
      ['Registrar incidencias con niños durante el día (si hubo)', null],
      ['Verificar que el área quede segura y ordenada para mañana', null],
      ['Revisar objetos olvidados de los niños', null]
    ]},
    { area_id: 'AREA-BARRA', tipo: 'apertura', nombre: 'Barra — Apertura', items: [
      ['Encender y calibrar máquina de café', null],
      ['Revisar limpieza y calibración del molino', null],
      ['Verificar producción de hielo suficiente', null],
      ['Revisar limpieza y surtido de cristalería', null],
      ['Verificar temperatura de refrigeradores de barra', null],
      ['Revisar existencia de leches, bebidas y refrescos', null],
      ['Verificar jarabes y guarniciones surtidos', null],
      ['Revisar limpieza de barra y estaciones', null]
    ]},
    { area_id: 'AREA-BARRA', tipo: 'cierre', nombre: 'Barra — Cierre', items: [
      ['Limpieza y purga de máquina de café', null],
      ['Limpieza de molino', null],
      ['Revisar y limpiar hielera', null],
      ['Lavar y guardar cristalería', null],
      ['Revisar y registrar temperatura de refrigeradores', null],
      ['Registrar faltantes de bebidas, jarabes y guarniciones', null],
      ['Sacar basura del área', null],
      ['Foto general de barra limpia y ordenada', 'barra']
    ]},
    { area_id: 'AREA-COCI', tipo: 'apertura', nombre: 'Cocina — Apertura', items: [
      ['Encender y verificar equipos de cocina', null],
      ['Revisar temperatura de refrigeradores y congeladores', null],
      ['Verificar etiquetado y caducidades de insumos', null],
      ['Mise en place del día (cortes, salsas, bases)', null],
      ['Revisar limpieza de superficies y utensilios', null],
      ['Verificar disponibilidad de gas / energía', null],
      ['Revisar uniforme e higiene del equipo de cocina', null]
    ]},
    { area_id: 'AREA-COCI', tipo: 'cierre', nombre: 'Cocina — Cierre', items: [
      ['Revisar y registrar temperaturas finales de refrigeradores/congeladores', null],
      ['Etiquetar y guardar insumos con fecha y contenido', null],
      ['Revisar caducidades próximas a vencer', null],
      ['Limpieza profunda de superficies, parrillas y utensilios', 'cocina'],
      ['Foto de refrigeradores ordenados y limpios', 'refrigeradores'],
      ['Sacar y separar la basura correctamente', null],
      ['Verificar almacenamiento seguro de insumos (alturas, cerrado)', null],
      ['Revisar seguridad de equipos (gas cerrado, apagados)', null],
      ['Dejar mise en place lista para el siguiente día', null]
    ]},
    { area_id: 'AREA-CAJA', tipo: 'apertura', nombre: 'Caja — Apertura', items: [
      ['Verificar fondo de caja inicial', null],
      ['Confirmar terminal(es) encendidas y funcionando', null],
      ['Revisar rollo de papel / tickets disponible', null],
      ['Confirmar acceso a Parrot funcionando correctamente', null]
    ]}
    // Caja — Cierre NO usa checklist genérico: usa el formulario especial (ver CajaCierre).
  ];
}

function seedChecklistsFull_() {
  var clSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CHECKLISTS);
  if (clSheet.getLastRow() > 1) return;
  writeChecklistDefinitions_();
}

function writeChecklistDefinitions_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var clSheet = ss.getSheetByName(SHEETS.CHECKLISTS);
  var itemSheet = ss.getSheetByName(SHEETS.ITEMS);
  var defs = checklistDefinitions_();
  var rowsCl = [], rowsItems = [];
  var clId = 1, itemId = 1;

  defs.forEach(function (def) {
    var id = 'CL-' + clId++;
    rowsCl.push([id, def.area_id, def.tipo, def.nombre, true]);
    def.items.forEach(function (pair, idx) {
      var texto = pair[0], tag = pair[1];
      rowsItems.push(['IT-' + itemId++, id, idx + 1, texto, !!tag, tag || '', true]);
    });
  });

  if (rowsCl.length) clSheet.getRange(2, 1, rowsCl.length, 5).setValues(rowsCl);
  if (rowsItems.length) itemSheet.getRange(2, 1, rowsItems.length, 7).setValues(rowsItems);
}

// ============================================================
// HTTP ENTRYPOINTS
// ============================================================
function doGet(e) {
  if (e && e.parameter && e.parameter.debug === 'fecha') {
    var sucursalId = e.parameter.sucursal_id || '';
    var fechaEnviada = e.parameter.fecha || todayStr_();
    var rows = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return !sucursalId || r.sucursal_id === sucursalId; });
    var out = rows.map(function (r) {
      return {
        id: r.id, sucursal_id: r.sucursal_id, area_id: r.area_id, tipo: r.tipo,
        fecha_valor: r.fecha, fecha_tipo: typeof r.fecha,
        coincide_con_fecha_enviada: r.fecha === fechaEnviada,
        enviado: r.enviado, pct: r.pct
      };
    });
    return jsonOut_({ ok: true, fecha_enviada: fechaEnviada, fecha_del_servidor: todayStr_(), debug: out });
  }
  return jsonOut_({ ok: true, service: 'cofki-checklist-api', version: '3.1.0-fix-fotos' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut_({ ok: false, error: 'JSON inválido' }); }

  var action = body.action;
  try {
    switch (action) {
      // ---- Auth / sesión (líder / admin) ----
      case 'login': return jsonOut_(actionLogin_(body));
      case 'validateSession': return jsonOut_(actionValidateSession_(body));
      case 'bootSesion': return jsonOut_(actionBootSesion_(body));
      case 'logout': return jsonOut_(actionLogout_(body));
      case 'getBootstrap': return jsonOut_(actionGetBootstrap_(body));
      case 'changePassword': return jsonOut_(actionChangePassword_(body));

      // ---- Público (piso, sin login) ----
      case 'bootPublico': return jsonOut_(actionBootPublico_(body));
      case 'listSucursales': return jsonOut_({ ok: true, sucursales: getAll_(SHEETS.SUCURSALES).filter(function (s) { return s.activa !== false; }) });
      case 'listAreas': return jsonOut_({ ok: true, areas: getAll_(SHEETS.AREAS).filter(function (a) { return a.activa !== false; }) });

      // ---- Usuarios (admin) ----
      case 'listUsuarios': return jsonOut_(actionListUsuarios_(body));
      case 'createUsuario': return jsonOut_(actionCreateUsuario_(body));
      case 'updateUsuario': return jsonOut_(actionUpdateUsuario_(body));

      // ---- Checklists (público) ----
      case 'getChecklistDef': return jsonOut_(actionGetChecklistDef_(body));
      case 'getOrCreateRespuesta': return jsonOut_(actionGetOrCreateRespuesta_(body));
      case 'getRespuestaEstado': return jsonOut_(actionGetRespuestaEstado_(body));
      case 'saveItemEstado': return jsonOut_(actionSaveItemEstado_(body));
      case 'addIncidencia': return jsonOut_(actionAddIncidencia_(body));
      case 'uploadFoto': return jsonOut_(actionUploadFoto_(body));
      case 'submitRespuesta': return jsonOut_(actionSubmitRespuesta_(body));
      case 'getRespuestaDetalle': return jsonOut_(actionGetRespuestaDetalle_(body));

      // ---- Validación en sitio (público — encargado/subgerente en turno) ----
      case 'validarEnSitio': return jsonOut_(actionValidarEnSitio_(body));
      case 'devolverEnSitio': return jsonOut_(actionDevolverEnSitio_(body));
      case 'validarCajaEnSitio': return jsonOut_(actionValidarCajaEnSitio_(body));
      case 'devolverCajaEnSitio': return jsonOut_(actionDevolverCajaEnSitio_(body));

      // ---- Aprobación remota (respaldo — solo admin) ----
      case 'aprobarRespuesta': return jsonOut_(actionAprobarRespuesta_(body));
      case 'devolverRespuesta': return jsonOut_(actionDevolverRespuesta_(body));
      case 'aprobarCaja': return jsonOut_(actionAprobarCaja_(body));
      case 'devolverCaja': return jsonOut_(actionDevolverCaja_(body));

      // ---- Caja (público) ----
      case 'submitCaja': return jsonOut_(actionSubmitCaja_(body));
      case 'getCaja': return jsonOut_(actionGetCaja_(body));

      // ---- Agua (público) ----
      case 'getLecturaAnterior': return jsonOut_(actionGetLecturaAnterior_(body));

      // ---- Dashboard / histórico (líder / admin) ----
      case 'getDashboard': // alias retrocompatible
      case 'getDashboardHoy': return jsonOut_(actionGetDashboardHoy_(body));
      case 'getSucursalDetalle': return jsonOut_(actionGetSucursalDetalle_(body));
      case 'getHistorico': return jsonOut_(actionGetHistorico_(body));
      case 'getPendientesAprobacion': return jsonOut_(actionGetPendientesAprobacion_(body));

      default: return jsonOut_({ ok: false, error: 'Acción desconocida: ' + action });
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Error de servidor: ' + err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// AUTH (líder / admin)
// ============================================================
function actionLogin_(body) {
  var usuario = (body.usuario || '').trim().toLowerCase();
  var password = body.password || '';
  if (!usuario || !password) return { ok: false, error: 'Usuario y password son requeridos' };

  var users = getAll_(SHEETS.USUARIOS);
  var user = users.filter(function (u) { return (u.usuario || '').toLowerCase() === usuario; })[0];
  if (!user) return { ok: false, error: 'Usuario o password incorrectos' };
  if (user.activo === false) return { ok: false, error: 'Usuario deshabilitado. Contacta a dirección.' };

  var hash = hashPassword_(password, user.salt);
  if (hash !== user.password_hash) return { ok: false, error: 'Usuario o password incorrectos' };

  var token = createSession_(user.id);
  return {
    ok: true, token: token, user: publicUser_(user),
    sucursales: getAll_(SHEETS.SUCURSALES).filter(function (s) { return s.activa !== false; }),
    areas: getAll_(SHEETS.AREAS).filter(function (a) { return a.activa !== false; })
  };
}

function actionValidateSession_(body) {
  var user = getUserFromToken_(body.token);
  if (!user) return { ok: false, error: 'Sesión inválida o expirada' };
  return { ok: true, user: publicUser_(user) };
}

// Combina validateSession + getBootstrap en un solo viaje al servidor
// (antes eran 2 llamadas separadas en cada apertura de la app).
function actionBootSesion_(body) {
  var user = getUserFromToken_(body.token);
  if (!user) return { ok: false, error: 'Sesión inválida o expirada' };
  return {
    ok: true, user: publicUser_(user),
    sucursales: getAll_(SHEETS.SUCURSALES).filter(function (s) { return s.activa !== false; }),
    areas: getAll_(SHEETS.AREAS).filter(function (a) { return a.activa !== false; })
  };
}

function actionLogout_(body) {
  var sh = getSheet_(SHEETS.SESIONES);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === body.token) { sh.deleteRow(i + 1); break; }
  }
  return { ok: true };
}

function actionChangePassword_(body) {
  var user = getUserFromToken_(body.token);
  if (!user) return { ok: false, error: 'Sesión inválida' };
  if (!body.newPassword || body.newPassword.length < 6) return { ok: false, error: 'La nueva contraseña debe tener al menos 6 caracteres' };
  var salt = generateSalt_();
  var hash = hashPassword_(body.newPassword, salt);
  updateRowByField_(SHEETS.USUARIOS, 'id', user.id, { password_hash: hash, salt: salt });
  return { ok: true };
}

function withAuth_(body, fn) {
  var user = getUserFromToken_(body.token);
  if (!user) return { ok: false, error: 'Sesión inválida o expirada' };
  return fn(user);
}

// Igual que withAuth_ pero no rechaza si no hay token — lo usan las
// acciones de captura de piso, que corren con o sin sesión.
function withAuthOpcional_(body, fn) {
  var user = body.token ? getUserFromToken_(body.token) : null;
  return fn(user);
}

function createSession_(userId) {
  var token = Utilities.getUuid();
  var now = new Date();
  var expira = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  getSheet_(SHEETS.SESIONES).appendRow([token, userId, now, expira]);
  return token;
}

function getUserFromToken_(token) {
  if (!token) return null;
  var sesion = getAll_(SHEETS.SESIONES).filter(function (s) { return s.token === token; })[0];
  if (!sesion) return null;
  if (new Date(sesion.expira) < new Date()) return null;
  return getAll_(SHEETS.USUARIOS).filter(function (u) { return u.id === sesion.usuario_id; })[0] || null;
}

function publicUser_(user) {
  return {
    id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol,
    sucursal_id: user.sucursal_id, activo: user.activo !== false,
    areas: user.areas ? String(user.areas).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : []
  };
}

function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + '::' + salt);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function generateSalt_() {
  var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var salt = '';
  for (var i = 0; i < SALT_BYTES; i++) salt += chars.charAt(Math.floor(Math.random() * chars.length));
  return salt;
}

// ============================================================
// BOOTSTRAP (público) / USUARIOS (admin)
// ============================================================
function actionBootPublico_(body) {
  return {
    ok: true,
    sucursales: getAll_(SHEETS.SUCURSALES).filter(function (s) { return s.activa !== false; }),
    areas: getAll_(SHEETS.AREAS).filter(function (a) { return a.activa !== false; })
  };
}

function actionGetBootstrap_(body) {
  return withAuth_(body, function (user) {
    return {
      ok: true, user: publicUser_(user),
      sucursales: getAll_(SHEETS.SUCURSALES).filter(function (s) { return s.activa !== false; }),
      areas: getAll_(SHEETS.AREAS).filter(function (a) { return a.activa !== false; })
    };
  });
}

function actionListUsuarios_(body) {
  return withAuth_(body, function (user) {
    if (user.rol !== 'admin') return { ok: false, error: 'Solo dirección puede ver usuarios' };
    return { ok: true, usuarios: getAll_(SHEETS.USUARIOS).map(publicUser_) };
  });
}

function actionCreateUsuario_(body) {
  return withAuth_(body, function (user) {
    if (user.rol !== 'admin') return { ok: false, error: 'Solo dirección puede crear usuarios' };
    var d = body.data || {};
    if (!d.nombre || !d.usuario || !d.password || !d.rol) return { ok: false, error: 'Faltan campos: nombre, usuario, password, rol' };

    var existentes = getAll_(SHEETS.USUARIOS);
    if (existentes.some(function (u) { return (u.usuario || '').toLowerCase() === d.usuario.toLowerCase(); })) {
      return { ok: false, error: 'Ese nombre de usuario ya existe' };
    }

    var salt = generateSalt_();
    var hash = hashPassword_(d.password, salt);
    var id = 'U-' + Utilities.getUuid().slice(0, 8);
    getSheet_(SHEETS.USUARIOS).appendRow([id, d.nombre, d.usuario, hash, salt, d.rol, d.sucursal_id || '', (d.areas || []).join(','), true, new Date()]);
    return { ok: true, id: id };
  });
}

function actionUpdateUsuario_(body) {
  return withAuth_(body, function (user) {
    if (user.rol !== 'admin') return { ok: false, error: 'Solo dirección puede editar usuarios' };
    var d = body.data || {};
    if (!d.id) return { ok: false, error: 'Falta id de usuario' };
    var fields = {};
    if (d.nombre) fields.nombre = d.nombre;
    if (d.rol) fields.rol = d.rol;
    if (d.sucursal_id !== undefined) fields.sucursal_id = d.sucursal_id;
    if (d.areas) fields.areas = d.areas.join(',');
    if (typeof d.activo === 'boolean') fields.activo = d.activo;
    if (d.password) {
      var salt = generateSalt_();
      fields.salt = salt;
      fields.password_hash = hashPassword_(d.password, salt);
    }
    updateRowByField_(SHEETS.USUARIOS, 'id', d.id, fields);
    return { ok: true };
  });
}

// ============================================================
// CHECKLISTS / RESPUESTAS (público — piso)
// ============================================================
function actionGetChecklistDef_(body) {
  var cl = getAll_(SHEETS.CHECKLISTS).filter(function (c) { return c.area_id === body.area_id && c.tipo === body.tipo && c.activo !== false; })[0];
  if (!cl) return { ok: false, error: 'No hay checklist configurado para esta área/tipo' };
  var items = getAll_(SHEETS.ITEMS).filter(function (it) { return it.checklist_id === cl.id && it.activo !== false; })
    .sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
  return { ok: true, checklist: cl, items: items };
}

function actionGetOrCreateRespuesta_(body) {
  return withAuthOpcional_(body, function (user) {
    var fecha = body.fecha || todayStr_();
    var def = actionGetChecklistDef_({ area_id: body.area_id, tipo: body.tipo });
    if (!def.ok) return def;

    // Bloqueo para evitar que dos peticiones casi simultáneas (doble toque,
    // dos pestañas, red lenta reintentando) creen dos filas duplicadas para
    // el mismo checklist del día.
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    var existente;
    try {
      existente = mejorRespuesta_(getAll_(SHEETS.RESPUESTAS).filter(function (r) {
        return r.sucursal_id === body.sucursal_id && r.area_id === body.area_id && r.tipo === body.tipo && r.fecha === fecha;
      }));
      if (!existente) {
        existente = nuevaRespuesta_(body.sucursal_id, body.area_id, body.tipo, fecha, user ? user.id : '', body.nombre || '');
        appendRowObj_(SHEETS.RESPUESTAS, existente);
      }
    } finally {
      lock.releaseLock();
    }

    return {
      ok: true, respuesta: existente, checklist: def.checklist, items: def.items,
      itemsEstado: getAll_(SHEETS.RESP_ITEMS).filter(function (ri) { return ri.respuesta_id === existente.id; }),
      fotos: getAll_(SHEETS.FOTOS).filter(function (f) { return f.respuesta_id === existente.id; }),
      incidencias: getAll_(SHEETS.INCIDENCIAS).filter(function (i) { return i.respuesta_id === existente.id; })
    };
  });
}

function actionGetRespuestaEstado_(body) {
  var respuesta = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
  if (!respuesta) return { ok: false, error: 'Respuesta no encontrada' };
  return { ok: true, respuesta: respuesta };
}

function nuevaRespuesta_(sucursalId, areaId, tipo, fecha, usuarioId, nombreCapturado) {
  var now = new Date();
  return {
    id: 'R-' + Utilities.getUuid().slice(0, 8), sucursal_id: sucursalId, area_id: areaId, tipo: tipo, fecha: fecha,
    usuario_id: usuarioId || '', capturado_por_nombre: nombreCapturado || '',
    estado: 'no_iniciado', pct: 0, tiene_incidencia: false,
    enviado: false, enviado_at: '', aprobado: false, aprobado_por: '', aprobado_at: '',
    comentario_aprobacion: '', validado_por_nombre: '', devuelto: false, motivo_devolucion: '',
    inventario_enviado: '', inventario_motivo: '', medidor_lectura: '', medidor_foto_url: '',
    creado_at: now, actualizado_at: now
  };
}

// Marca una tarea y regresa la respuesta ya recalculada en el mismo viaje
// (antes había que hacer una segunda llamada aparte para refrescar el %).
function actionSaveItemEstado_(body) {
  return withAuthOpcional_(body, function (user) {
    var respuesta = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
    if (!respuesta) return { ok: false, error: 'Respuesta no encontrada' };
    if (respuesta.aprobado === true) return { ok: false, error: 'Este checklist ya fue validado y está bloqueado' };

    var actor = user ? user.id : (body.nombre || 'anónimo');
    var existRow = getAll_(SHEETS.RESP_ITEMS).filter(function (ri) { return ri.respuesta_id === body.respuesta_id && ri.item_id === body.item_id; })[0];
    if (existRow) {
      updateRowByField_(SHEETS.RESP_ITEMS, 'id', existRow.id, { estado: body.estado, nota: body.nota || '', actualizado_at: new Date(), actualizado_por: actor });
    } else {
      appendRowObj_(SHEETS.RESP_ITEMS, { id: 'RI-' + Utilities.getUuid().slice(0, 8), respuesta_id: body.respuesta_id, item_id: body.item_id, estado: body.estado, nota: body.nota || '', actualizado_at: new Date(), actualizado_por: actor });
    }
    recomputeRespuesta_(body.respuesta_id);
    var actualizada = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
    return { ok: true, respuesta: actualizada };
  });
}

function recomputeRespuesta_(respuestaId) {
  var respuesta = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === respuestaId; })[0];
  if (!respuesta) return;
  var cl = getAll_(SHEETS.CHECKLISTS).filter(function (c) { return c.area_id === respuesta.area_id && c.tipo === respuesta.tipo; })[0];
  var totalItems = cl ? getAll_(SHEETS.ITEMS).filter(function (it) { return it.checklist_id === cl.id && it.activo !== false; }).length : 0;
  var itemsEstado = getAll_(SHEETS.RESP_ITEMS).filter(function (ri) { return ri.respuesta_id === respuestaId; });
  var done = itemsEstado.filter(function (ri) { return ri.estado === 'ok' || ri.estado === 'na'; }).length;
  var tieneIncidencia = itemsEstado.some(function (ri) { return ri.estado === 'incidencia'; });
  var pct = totalItems > 0 ? Math.round((done / totalItems) * 100) : 0;

  var estado;
  if (tieneIncidencia) estado = 'incidencia';
  else if (done === 0) estado = 'no_iniciado';
  else if (totalItems > 0 && done >= totalItems) estado = 'completo';
  else estado = 'en_progreso';

  updateRowByField_(SHEETS.RESPUESTAS, 'id', respuestaId, { pct: pct, estado: estado, tiene_incidencia: tieneIncidencia, actualizado_at: new Date() });
}

function actionAddIncidencia_(body) {
  return withAuthOpcional_(body, function (user) {
    var respuesta = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
    if (!respuesta) return { ok: false, error: 'Respuesta no encontrada' };
    if (!body.texto) return { ok: false, error: 'Describe la incidencia' };
    var actor = user ? user.id : (body.nombre || 'anónimo');

    appendRowObj_(SHEETS.INCIDENCIAS, {
      id: 'INC-' + Utilities.getUuid().slice(0, 8), respuesta_id: body.respuesta_id, item_id: body.item_id || '',
      sucursal_id: respuesta.sucursal_id, area_id: respuesta.area_id,
      texto: body.texto, foto_url: body.foto_url || '', estado: 'abierta',
      creado_por: actor, creado_at: new Date()
    });

    if (body.item_id) {
      return actionSaveItemEstado_({ token: body.token, nombre: body.nombre, respuesta_id: body.respuesta_id, item_id: body.item_id, estado: 'incidencia', nota: body.texto });
    }
    recomputeRespuesta_(body.respuesta_id);
    var actualizada = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
    return { ok: true, respuesta: actualizada };
  });
}

// ============================================================
// FOTOS (evidencia) — público
// ============================================================
function getPhotoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('PHOTO_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) { /* recrear abajo */ }
  }
  var folder = DriveApp.createFolder('Cofki Checklist - Evidencias');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

// Corre esto si tenías fotos guardadas con el formato de URL viejo
// (drive.google.com/uc?id=...) y quieres que también se vean en la app
// sin tener que volver a subirlas.
function arreglarUrlsFotos() {
  function nuevaUrl(vieja) {
    if (!vieja) return vieja;
    var m = String(vieja).match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (!m) return vieja;
    return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w2000';
  }

  var cambios = 0;
  getAll_(SHEETS.FOTOS).forEach(function (f) {
    var nueva = nuevaUrl(f.drive_url);
    if (nueva !== f.drive_url) { updateRowByField_(SHEETS.FOTOS, 'id', f.id, { drive_url: nueva }); cambios++; }
  });

  getAll_(SHEETS.CAJA).forEach(function (c) {
    var fields = {};
    var nuevaArqueo = nuevaUrl(c.foto_arqueo_url);
    if (nuevaArqueo !== c.foto_arqueo_url) fields.foto_arqueo_url = nuevaArqueo;
    if (c.fotos_terminal_urls) {
      var nuevaLista = String(c.fotos_terminal_urls).split(',').map(nuevaUrl).join(',');
      if (nuevaLista !== c.fotos_terminal_urls) fields.fotos_terminal_urls = nuevaLista;
    }
    if (Object.keys(fields).length) { updateRowByField_(SHEETS.CAJA, 'id', c.id, fields); cambios++; }
  });

  getAll_(SHEETS.RESPUESTAS).forEach(function (r) {
    var nueva = nuevaUrl(r.medidor_foto_url);
    if (nueva !== r.medidor_foto_url) { updateRowByField_(SHEETS.RESPUESTAS, 'id', r.id, { medidor_foto_url: nueva }); cambios++; }
  });

  Logger.log('URLs de fotos actualizadas: ' + cambios + ' registro(s).');
}

function uploadFotoDrive_(base64, filename, mimeType) {
  var folder = getPhotoFolder_();
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', filename || ('foto_' + Date.now() + '.jpg'));
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // El formato "uc?id=" no siempre sirve para mostrar la imagen directo en
  // la app (a veces Google muestra una página intermedia en su lugar). Este
  // formato de miniatura es el que sí funciona de forma confiable en <img>.
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w2000';
}

// Sube la foto y, si viene item_id, también marca esa tarea como hecha —
// todo en un solo viaje al servidor (antes eran hasta 3 llamadas seguidas).
function actionUploadFoto_(body) {
  return withAuthOpcional_(body, function (user) {
    if (!body.base64) return { ok: false, error: 'Falta la imagen' };
    var url = uploadFotoDrive_(body.base64, body.filename, body.mimeType);
    var now = new Date();
    var actor = user ? user.id : (body.nombre || 'anónimo');
    appendRowObj_(SHEETS.FOTOS, {
      id: 'F-' + Utilities.getUuid().slice(0, 8), respuesta_id: body.respuesta_id || '', tipo_evidencia: body.tipo_evidencia || '',
      sucursal_id: body.sucursal_id, area_id: body.area_id || '', usuario_id: actor,
      fecha: todayStr_(), hora: Utilities.formatDate(now, TIMEZONE, 'HH:mm'),
      drive_url: url, creado_at: now
    });

    var respuestaActualizada = null;
    if (body.item_id && body.respuesta_id) {
      var existRow = getAll_(SHEETS.RESP_ITEMS).filter(function (ri) { return ri.respuesta_id === body.respuesta_id && ri.item_id === body.item_id; })[0];
      if (existRow) {
        updateRowByField_(SHEETS.RESP_ITEMS, 'id', existRow.id, { estado: 'ok', actualizado_at: now, actualizado_por: actor });
      } else {
        appendRowObj_(SHEETS.RESP_ITEMS, { id: 'RI-' + Utilities.getUuid().slice(0, 8), respuesta_id: body.respuesta_id, item_id: body.item_id, estado: 'ok', nota: '', actualizado_at: now, actualizado_por: actor });
      }
      recomputeRespuesta_(body.respuesta_id);
      respuestaActualizada = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
    }

    return { ok: true, url: url, respuesta: respuestaActualizada };
  });
}

// ============================================================
// SUBMIT (envío del colaborador — todavía falta la validación en sitio)
// ============================================================
function actionSubmitRespuesta_(body) {
  return withAuthOpcional_(body, function (user) {
    var respuesta = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
    if (!respuesta) return { ok: false, error: 'Respuesta no encontrada' };
    if (respuesta.aprobado === true) return { ok: false, error: 'Ya fue validado, no se puede reenviar' };

    var cl = getAll_(SHEETS.CHECKLISTS).filter(function (c) { return c.area_id === respuesta.area_id && c.tipo === respuesta.tipo; })[0];
    var items = cl ? getAll_(SHEETS.ITEMS).filter(function (it) { return it.checklist_id === cl.id && it.activo !== false; }) : [];
    var itemsEstado = getAll_(SHEETS.RESP_ITEMS).filter(function (ri) { return ri.respuesta_id === respuesta.id; });
    var fotos = getAll_(SHEETS.FOTOS).filter(function (f) { return f.respuesta_id === respuesta.id; });

    var faltantesFoto = [];
    items.forEach(function (it) {
      if (it.requiere_foto === true) {
        var tieneFoto = fotos.some(function (f) { return f.tipo_evidencia === it.evidencia_tag; });
        if (!tieneFoto) faltantesFoto.push(it.texto);
      }
    });
    if (faltantesFoto.length) return { ok: false, error: 'Faltan fotos obligatorias: ' + faltantesFoto.join(', ') };

    var pendientes = items.filter(function (it) {
      return !itemsEstado.some(function (ri) { return ri.item_id === it.id && (ri.estado === 'ok' || ri.estado === 'na' || ri.estado === 'incidencia'); });
    });
    if (pendientes.length) return { ok: false, error: 'Faltan ' + pendientes.length + ' tarea(s) por marcar' };

    var extra = body.extra || {};
    var fields = { enviado: true, enviado_at: new Date(), devuelto: false, actualizado_at: new Date() };
    if (body.nombre && !respuesta.capturado_por_nombre) fields.capturado_por_nombre = body.nombre;

    if (respuesta.area_id === AREA_SERVICIO && respuesta.tipo === 'cierre') {
      if (typeof extra.inventario_enviado !== 'boolean') return { ok: false, error: 'Falta confirmar si se envió el inventario diario' };
      if (!extra.inventario_enviado && !extra.inventario_motivo) return { ok: false, error: 'Indica el motivo por el que no se envió el inventario' };
      fields.inventario_enviado = extra.inventario_enviado;
      fields.inventario_motivo = extra.inventario_enviado ? '' : extra.inventario_motivo;
      upsertInventarioCierre_(respuesta.sucursal_id, respuesta.fecha, extra.inventario_enviado, extra.inventario_motivo || '', body.nombre || (user ? user.id : ''));
    }

    if (respuesta.area_id === AREA_SERVICIO && respuesta.tipo === 'apertura') {
      var sucursal = getAll_(SHEETS.SUCURSALES).filter(function (s) { return s.id === respuesta.sucursal_id; })[0];
      if (sucursal && sucursal.codigo === SUCURSAL_CODIGO_AGUA) {
        if (!extra.medidor_lectura || !extra.medidor_foto_url) return { ok: false, error: 'Falta la lectura y foto del medidor de agua' };
        fields.medidor_lectura = extra.medidor_lectura;
        fields.medidor_foto_url = extra.medidor_foto_url;
        saveLecturaAgua_(respuesta.sucursal_id, extra.medidor_lectura, extra.medidor_foto_url, body.nombre || (user ? user.id : ''));
      }
    }

    updateRowByField_(SHEETS.RESPUESTAS, 'id', respuesta.id, fields);
    recomputeRespuesta_(respuesta.id);
    var actualizada = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === respuesta.id; })[0];
    return { ok: true, respuesta: actualizada };
  });
}

function upsertInventarioCierre_(sucursalId, fecha, enviado, motivo, actor) {
  var existente = getAll_(SHEETS.INVENTARIO).filter(function (r) { return r.sucursal_id === sucursalId && r.fecha === fecha; })[0];
  if (existente) {
    updateRowByField_(SHEETS.INVENTARIO, 'id', existente.id, { enviado: enviado, motivo: motivo, usuario_id: actor });
  } else {
    appendRowObj_(SHEETS.INVENTARIO, { id: 'INV-' + Utilities.getUuid().slice(0, 8), sucursal_id: sucursalId, fecha: fecha, enviado: enviado, motivo: motivo, usuario_id: actor, modulo_origen: 'manual', creado_at: new Date() });
  }
}

function saveLecturaAgua_(sucursalId, lectura, fotoUrl, actor) {
  var historicas = getAll_(SHEETS.AGUA).filter(function (r) { return r.sucursal_id === sucursalId; })
    .sort(function (a, b) { return new Date(a.creado_at) - new Date(b.creado_at); });
  var anterior = historicas.length ? historicas[historicas.length - 1] : null;
  var consumo = anterior ? (Number(lectura) - Number(anterior.lectura)) : '';
  var now = new Date();
  appendRowObj_(SHEETS.AGUA, {
    id: 'AG-' + Utilities.getUuid().slice(0, 8), sucursal_id: sucursalId, fecha: todayStr_(),
    lectura: lectura, foto_url: fotoUrl, usuario_id: actor,
    hora: Utilities.formatDate(now, TIMEZONE, 'HH:mm'), consumo: consumo, creado_at: now
  });
}

function actionGetLecturaAnterior_(body) {
  var historicas = getAll_(SHEETS.AGUA).filter(function (r) { return r.sucursal_id === body.sucursal_id; })
    .sort(function (a, b) { return new Date(b.creado_at) - new Date(a.creado_at); });
  return { ok: true, anterior: historicas.length ? historicas[0] : null };
}

// ============================================================
// DETALLE (público)
// ============================================================
function actionGetRespuestaDetalle_(body) {
  var respuesta = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
  if (!respuesta) return { ok: false, error: 'No encontrada' };
  var cl = getAll_(SHEETS.CHECKLISTS).filter(function (c) { return c.area_id === respuesta.area_id && c.tipo === respuesta.tipo; })[0];
  var items = cl ? getAll_(SHEETS.ITEMS).filter(function (it) { return it.checklist_id === cl.id; }).sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); }) : [];
  return {
    ok: true, respuesta: respuesta, items: items,
    itemsEstado: getAll_(SHEETS.RESP_ITEMS).filter(function (ri) { return ri.respuesta_id === respuesta.id; }),
    fotos: getAll_(SHEETS.FOTOS).filter(function (f) { return f.respuesta_id === respuesta.id; }),
    incidencias: getAll_(SHEETS.INCIDENCIAS).filter(function (i) { return i.respuesta_id === respuesta.id; })
  };
}

// ============================================================
// VALIDACIÓN EN SITIO — encargado/subgerente en turno (público, sin login)
// ============================================================
function actionValidarEnSitio_(body) {
  var respuesta = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
  if (!respuesta) return { ok: false, error: 'Respuesta no encontrada' };
  if (!respuesta.enviado) return { ok: false, error: 'El checklist todavía no se ha enviado' };
  if (respuesta.aprobado === true) return { ok: false, error: 'Ya estaba validado' };
  if (!body.nombre_encargado) return { ok: false, error: 'Escribe el nombre de quien valida' };
  updateRowByField_(SHEETS.RESPUESTAS, 'id', respuesta.id, {
    aprobado: true, aprobado_por: body.nombre_encargado, aprobado_at: new Date(),
    validado_por_nombre: body.nombre_encargado, comentario_aprobacion: body.comentario || ''
  });
  return { ok: true };
}

function actionDevolverEnSitio_(body) {
  var respuesta = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
  if (!respuesta) return { ok: false, error: 'Respuesta no encontrada' };
  if (!body.motivo) return { ok: false, error: 'Indica qué debe corregirse' };
  updateRowByField_(SHEETS.RESPUESTAS, 'id', respuesta.id, { devuelto: true, motivo_devolucion: body.motivo, enviado: false, aprobado: false });
  return { ok: true };
}

function actionValidarCajaEnSitio_(body) {
  var caja = getAll_(SHEETS.CAJA).filter(function (c) { return c.id === body.caja_id; })[0];
  if (!caja) return { ok: false, error: 'No encontrada' };
  if (!body.nombre_encargado) return { ok: false, error: 'Escribe el nombre de quien valida' };
  updateRowByField_(SHEETS.CAJA, 'id', caja.id, { aprobado: true, aprobado_por: body.nombre_encargado, aprobado_at: new Date(), comentario: body.comentario || '' });
  updateRowByField_(SHEETS.RESPUESTAS, 'id', caja.respuesta_id, { aprobado: true, aprobado_por: body.nombre_encargado, aprobado_at: new Date(), validado_por_nombre: body.nombre_encargado });
  return { ok: true };
}

function actionDevolverCajaEnSitio_(body) {
  var caja = getAll_(SHEETS.CAJA).filter(function (c) { return c.id === body.caja_id; })[0];
  if (!caja) return { ok: false, error: 'No encontrada' };
  if (!body.motivo) return { ok: false, error: 'Indica qué debe corregirse' };
  updateRowByField_(SHEETS.RESPUESTAS, 'id', caja.respuesta_id, { devuelto: true, motivo_devolucion: body.motivo, enviado: false, aprobado: false });
  return { ok: true };
}

// ============================================================
// APROBACIÓN REMOTA — respaldo, solo dirección
// ============================================================
function actionAprobarRespuesta_(body) {
  return withAuth_(body, function (user) {
    if (user.rol !== 'admin') return { ok: false, error: 'Solo dirección puede aprobar de forma remota' };
    var respuesta = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
    if (!respuesta) return { ok: false, error: 'No encontrada' };
    if (!respuesta.enviado) return { ok: false, error: 'Aún no ha sido enviado' };
    updateRowByField_(SHEETS.RESPUESTAS, 'id', respuesta.id, { aprobado: true, aprobado_por: user.nombre, aprobado_at: new Date(), comentario_aprobacion: body.comentario || '', validado_por_nombre: user.nombre + ' (dirección, remoto)' });
    return { ok: true };
  });
}

function actionDevolverRespuesta_(body) {
  return withAuth_(body, function (user) {
    if (user.rol !== 'admin') return { ok: false, error: 'Solo dirección puede devolver de forma remota' };
    if (!body.motivo) return { ok: false, error: 'Indica qué debe corregirse' };
    var respuesta = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.id === body.respuesta_id; })[0];
    if (!respuesta) return { ok: false, error: 'No encontrada' };
    updateRowByField_(SHEETS.RESPUESTAS, 'id', respuesta.id, { devuelto: true, motivo_devolucion: body.motivo, enviado: false, aprobado: false });
    return { ok: true };
  });
}

function actionGetPendientesAprobacion_(body) {
  return withAuth_(body, function (user) {
    if (user.rol !== 'admin' && user.rol !== 'lider') return { ok: false, error: 'No tienes permiso' };
    var respuestas = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.enviado === true && r.aprobado !== true; });
    var areas = getAll_(SHEETS.AREAS);
    var sucursales = getAll_(SHEETS.SUCURSALES);
    var out = respuestas.map(function (r) {
      return {
        respuesta_id: r.id, sucursal_id: r.sucursal_id,
        sucursal_nombre: (sucursales.filter(function (s) { return s.id === r.sucursal_id; })[0] || {}).nombre,
        area_id: r.area_id, area_nombre: (areas.filter(function (a) { return a.id === r.area_id; })[0] || {}).nombre,
        tipo: r.tipo, fecha: r.fecha, pct: r.pct, tiene_incidencia: r.tiene_incidencia, enviado_at: r.enviado_at,
        capturado_por_nombre: r.capturado_por_nombre
      };
    });
    return { ok: true, pendientes: out };
  });
}

// ============================================================
// CAJA (simplificada) — público
// ============================================================
function getOrCreateCajaRespuesta_(sucursalId, fecha, userId, nombreCapturado) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var existente = mejorRespuesta_(getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.sucursal_id === sucursalId && r.area_id === AREA_CAJA && r.tipo === 'cierre' && r.fecha === fecha; }));
    if (existente) return existente;
    var row = nuevaRespuesta_(sucursalId, AREA_CAJA, 'cierre', fecha, userId, nombreCapturado);
    appendRowObj_(SHEETS.RESPUESTAS, row);
    return row;
  } finally {
    lock.releaseLock();
  }
}

function actionSubmitCaja_(body) {
  return withAuthOpcional_(body, function (user) {
    var fecha = body.fecha || todayStr_();
    var respuesta = getOrCreateCajaRespuesta_(body.sucursal_id, fecha, user ? user.id : '', body.nombre || '');
    if (respuesta.aprobado === true) return { ok: false, error: 'La caja de hoy ya fue validada, no se puede modificar' };

    if (typeof body.diferencia !== 'boolean') return { ok: false, error: 'Indica si existe diferencia de caja' };
    if (body.diferencia && (!body.monto || !body.explicacion)) return { ok: false, error: 'Indica el monto y la explicación de la diferencia' };
    if (!body.foto_arqueo_url) return { ok: false, error: 'Falta la foto del arqueo de caja (Parrot)' };
    if (!body.fotos_terminal_urls || !body.fotos_terminal_urls.length) return { ok: false, error: 'Falta al menos una foto de corte de terminal' };

    var estado = body.diferencia ? 'diferencia_reportada' : 'sin_diferencia';
    var now = new Date();
    var existente = getAll_(SHEETS.CAJA).filter(function (c) { return c.respuesta_id === respuesta.id; })[0];

    var payload = {
      diferencia: body.diferencia, monto: body.diferencia ? body.monto : '', explicacion: body.diferencia ? body.explicacion : '',
      foto_arqueo_url: body.foto_arqueo_url, fotos_terminal_urls: body.fotos_terminal_urls.join(','), estado: estado
    };

    var cajaId;
    if (existente) {
      cajaId = existente.id;
      updateRowByField_(SHEETS.CAJA, 'id', existente.id, payload);
    } else {
      cajaId = 'CJ-' + Utilities.getUuid().slice(0, 8);
      payload.id = cajaId;
      payload.sucursal_id = body.sucursal_id;
      payload.fecha = fecha;
      payload.respuesta_id = respuesta.id;
      payload.aprobado = false; payload.aprobado_por = ''; payload.aprobado_at = ''; payload.comentario = '';
      payload.usuario_id = user ? user.id : (body.nombre || '');
      payload.creado_at = now;
      appendRowObj_(SHEETS.CAJA, payload);
    }

    updateRowByField_(SHEETS.RESPUESTAS, 'id', respuesta.id, {
      estado: body.diferencia ? 'incidencia' : 'completo', pct: 100, tiene_incidencia: !!body.diferencia,
      enviado: true, enviado_at: now, devuelto: false, actualizado_at: now,
      capturado_por_nombre: respuesta.capturado_por_nombre || body.nombre || ''
    });

    return { ok: true, caja_id: cajaId, respuesta_id: respuesta.id };
  });
}

function actionGetCaja_(body) {
  var fecha = body.fecha || todayStr_();
  var caja = getAll_(SHEETS.CAJA).filter(function (c) { return c.sucursal_id === body.sucursal_id && c.fecha === fecha; })[0];
  return { ok: true, caja: caja || null };
}

function actionAprobarCaja_(body) {
  return withAuth_(body, function (user) {
    if (user.rol !== 'admin') return { ok: false, error: 'Solo dirección puede aprobar de forma remota' };
    var caja = getAll_(SHEETS.CAJA).filter(function (c) { return c.id === body.caja_id; })[0];
    if (!caja) return { ok: false, error: 'No encontrada' };
    updateRowByField_(SHEETS.CAJA, 'id', caja.id, { aprobado: true, aprobado_por: user.nombre, aprobado_at: new Date(), comentario: body.comentario || '' });
    updateRowByField_(SHEETS.RESPUESTAS, 'id', caja.respuesta_id, { aprobado: true, aprobado_por: user.nombre, aprobado_at: new Date(), comentario_aprobacion: body.comentario || '' });
    return { ok: true };
  });
}

function actionDevolverCaja_(body) {
  return withAuth_(body, function (user) {
    if (user.rol !== 'admin') return { ok: false, error: 'Solo dirección puede devolver de forma remota' };
    if (!body.motivo) return { ok: false, error: 'Indica qué debe corregirse' };
    var caja = getAll_(SHEETS.CAJA).filter(function (c) { return c.id === body.caja_id; })[0];
    if (!caja) return { ok: false, error: 'No encontrada' };
    updateRowByField_(SHEETS.RESPUESTAS, 'id', caja.respuesta_id, { devuelto: true, motivo_devolucion: body.motivo, enviado: false, aprobado: false });
    return { ok: true };
  });
}

// ============================================================
// DASHBOARD / HISTÓRICO (líder / admin — ven las 3 sucursales)
// ============================================================
function mejorRespuesta_(lista) {
  if (!lista || !lista.length) return null;
  return lista.slice().sort(function (a, b) {
    if (!!a.aprobado !== !!b.aprobado) return a.aprobado ? -1 : 1;
    if (!!a.enviado !== !!b.enviado) return a.enviado ? -1 : 1;
    if ((b.pct || 0) !== (a.pct || 0)) return (b.pct || 0) - (a.pct || 0);
    return new Date(b.actualizado_at || 0) - new Date(a.actualizado_at || 0);
  })[0];
}

function actionGetDashboardHoy_(body) {
  return withAuth_(body, function (user) {
    var fecha = body.fecha || todayStr_();
    var sucursales = getAll_(SHEETS.SUCURSALES).filter(function (s) { return s.activa !== false; });
    // admin y lider ven las 3 sucursales; ningún otro rol llega aquí sin sesión.

    var areas = getAll_(SHEETS.AREAS).filter(function (a) { return a.activa !== false; });
    var respuestas = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.fecha === fecha; });
    var incidenciasAbiertas = getAll_(SHEETS.INCIDENCIAS).filter(function (i) { return i.estado === 'abierta'; });
    var cajas = getAll_(SHEETS.CAJA).filter(function (c) { return c.fecha === fecha; });
    var inventarios = getAll_(SHEETS.INVENTARIO).filter(function (i) { return i.fecha === fecha; });
    var fotos = getAll_(SHEETS.FOTOS).filter(function (f) { return f.fecha === fecha; });
    var items = getAll_(SHEETS.ITEMS);
    var checklists = getAll_(SHEETS.CHECKLISTS);

    var atencion = [];

    var sucursalesOut = sucursales.map(function (suc) {
      var respSuc = respuestas.filter(function (r) { return r.sucursal_id === suc.id; });
      var aperturaResp = respSuc.filter(function (r) { return r.tipo === 'apertura'; });
      var cierreResp = respSuc.filter(function (r) { return r.tipo === 'cierre'; });

      var aperturaPct = avgPct_(aperturaResp, areas);
      var cierrePct = avgPct_(cierreResp, areas);
      var generalPct = Math.round((aperturaPct + cierrePct) / 2);

      var rojo = false;
      var incidenciasSuc = incidenciasAbiertas.filter(function (i) { return i.sucursal_id === suc.id; });
      var cajaSuc = cajas.filter(function (c) { return c.sucursal_id === suc.id; })[0];
      var invSuc = inventarios.filter(function (i) { return i.sucursal_id === suc.id; })[0];

      incidenciasSuc.forEach(function (inc) {
        rojo = true;
        var areaNombre = (areas.filter(function (a) { return a.id === inc.area_id; })[0] || {}).nombre || inc.area_id;
        atencion.push({ texto: suc.nombre + ' — Incidencia pendiente (' + areaNombre + ')', sucursal_id: suc.id, target: { view: 'checklist', sucursal_id: suc.id, area_id: inc.area_id, tipo: 'cierre' } });
      });

      if (cajaSuc && cajaSuc.diferencia === true) {
        rojo = true;
        atencion.push({ texto: suc.nombre + ' — Diferencia de caja', sucursal_id: suc.id, target: { view: 'caja', sucursal_id: suc.id } });
      }
      if (invSuc && invSuc.enviado === false) {
        rojo = true;
        atencion.push({ texto: suc.nombre + ' — Inventario no enviado', sucursal_id: suc.id, target: { view: 'checklist', sucursal_id: suc.id, area_id: AREA_SERVICIO, tipo: 'cierre' } });
      }

      areas.forEach(function (area) {
        var r = mejorRespuesta_(cierreResp.filter(function (x) { return x.area_id === area.id; })) ||
                mejorRespuesta_(aperturaResp.filter(function (x) { return x.area_id === area.id; }));
        if (r && r.enviado && r.pct < 90) {
          atencion.push({ texto: suc.nombre + ' — ' + area.nombre + ' ' + r.pct + '%', sucursal_id: suc.id, target: { view: 'checklist', sucursal_id: suc.id, area_id: area.id, tipo: r.tipo } });
        }
      });

      areas.forEach(function (area) {
        var r = mejorRespuesta_(cierreResp.filter(function (x) { return x.area_id === area.id; }));
        if (!r) return;
        var cl = checklists.filter(function (c) { return c.area_id === r.area_id && c.tipo === 'cierre'; })[0];
        if (!cl) return;
        var reqItems = items.filter(function (it) { return it.checklist_id === cl.id && it.requiere_foto === true; });
        reqItems.forEach(function (it) {
          var tieneFoto = fotos.some(function (f) { return f.tipo_evidencia === it.evidencia_tag && f.sucursal_id === suc.id; });
          if (!tieneFoto) {
            rojo = true;
            atencion.push({ texto: suc.nombre + ' — Falta foto de ' + it.evidencia_tag, sucursal_id: suc.id, target: { view: 'checklist', sucursal_id: suc.id, area_id: r.area_id, tipo: 'cierre' } });
          }
        });
      });

      var estado;
      if (aperturaPct === 0 && cierrePct === 0) estado = 'no_iniciado';
      else if (rojo) estado = 'incidencia';
      else if (generalPct >= 98) estado = 'completo';
      else estado = 'pendiente';

      return { sucursal_id: suc.id, sucursal_nombre: suc.nombre, sucursal_codigo: suc.codigo, apertura_pct: aperturaPct, cierre_pct: cierrePct, general_pct: generalPct, estado: estado };
    });

    var vistos = {};
    atencion = atencion.filter(function (a) { if (vistos[a.texto]) return false; vistos[a.texto] = true; return true; });

    return { ok: true, fecha: fecha, sucursales: sucursalesOut, atencion: atencion };
  });
}

function avgPct_(respuestasTipo, areas) {
  if (!areas.length) return 0;
  var suma = 0;
  areas.forEach(function (area) {
    var mejor = mejorRespuesta_(respuestasTipo.filter(function (r) { return r.area_id === area.id; }));
    suma += mejor ? (mejor.pct || 0) : 0;
  });
  return Math.round(suma / areas.length);
}

// Se usa tanto por el tablero público del piso (elegir sucursal, sin login)
// como por líder/admin (drill-down) — no requiere sesión.
function actionGetSucursalDetalle_(body) {
  var fecha = body.fecha || todayStr_();
  var suc = getAll_(SHEETS.SUCURSALES).filter(function (s) { return s.id === body.sucursal_id; })[0];
  if (!suc) return { ok: false, error: 'Sucursal no encontrada' };
  var areas = getAll_(SHEETS.AREAS).filter(function (a) { return a.activa !== false; });
  var respuestas = getAll_(SHEETS.RESPUESTAS).filter(function (r) { return r.sucursal_id === suc.id && r.fecha === fecha; });
  var caja = getAll_(SHEETS.CAJA).filter(function (c) { return c.sucursal_id === suc.id && c.fecha === fecha; })[0];
  var inventario = getAll_(SHEETS.INVENTARIO).filter(function (i) { return i.sucursal_id === suc.id && i.fecha === fecha; })[0];

  var areasOut = areas.map(function (area) {
    var ap = mejorRespuesta_(respuestas.filter(function (r) { return r.area_id === area.id && r.tipo === 'apertura'; }));
    var ci = mejorRespuesta_(respuestas.filter(function (r) { return r.area_id === area.id && r.tipo === 'cierre'; }));
    var vacio = { pct: 0, estado: 'no_iniciado', enviado: false, aprobado: false, respuesta_id: null, devuelto: false, motivo_devolucion: '' };
    return {
      area_id: area.id, area_nombre: area.nombre,
      apertura: ap ? { pct: ap.pct, estado: ap.estado, enviado: ap.enviado, aprobado: ap.aprobado, respuesta_id: ap.id, devuelto: ap.devuelto, motivo_devolucion: ap.motivo_devolucion } : vacio,
      cierre: ci ? { pct: ci.pct, estado: ci.estado, enviado: ci.enviado, aprobado: ci.aprobado, respuesta_id: ci.id, devuelto: ci.devuelto, motivo_devolucion: ci.motivo_devolucion } : vacio
    };
  });

  var evidencias = 0;
  if (caja) evidencias = [caja.foto_arqueo_url, caja.fotos_terminal_urls].join(',').split(',').filter(Boolean).length;

  return {
    ok: true, sucursal: suc, fecha: fecha, areas: areasOut,
    caja: caja ? { id: caja.id, estado: caja.estado, diferencia: caja.diferencia, monto: caja.monto, aprobado: caja.aprobado, evidencias: evidencias } : { estado: 'pendiente', evidencias: 0 },
    inventario: inventario ? { enviado: inventario.enviado, motivo: inventario.motivo } : { enviado: null }
  };
}

function actionGetHistorico_(body) {
  return withAuth_(body, function () {
    var respuestas = getAll_(SHEETS.RESPUESTAS);
    if (body.sucursal_id) respuestas = respuestas.filter(function (r) { return r.sucursal_id === body.sucursal_id; });
    if (body.area_id) respuestas = respuestas.filter(function (r) { return r.area_id === body.area_id; });
    if (body.fecha_inicio) respuestas = respuestas.filter(function (r) { return r.fecha >= body.fecha_inicio; });
    if (body.fecha_fin) respuestas = respuestas.filter(function (r) { return r.fecha <= body.fecha_fin; });

    var porFecha = {};
    respuestas.forEach(function (r) {
      if (!porFecha[r.fecha]) porFecha[r.fecha] = [];
      porFecha[r.fecha].push(r.pct || 0);
    });
    var serie = Object.keys(porFecha).sort().map(function (fecha) {
      var vals = porFecha[fecha];
      var avg = Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length);
      return { fecha: fecha, pct: avg };
    });

    return { ok: true, serie: serie };
  });
}

// ============================================================
// HELPERS DE SHEETS
// ============================================================
function getSheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Hoja no encontrada: ' + name);
  return sh;
}

function getAll_(sheetName) {
  var sh = getSheet_(sheetName);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      var val = values[i][j];
      if (headers[j] === 'fecha' && Object.prototype.toString.call(val) === '[object Date]') {
        val = Utilities.formatDate(val, TIMEZONE, 'yyyy-MM-dd');
      }
      row[headers[j]] = val;
    }
    rows.push(row);
  }
  return rows;
}

function appendRowObj_(sheetName, obj) {
  var sh = getSheet_(sheetName);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; }));
}

function updateRowByField_(sheetName, keyField, keyValue, fields) {
  var sh = getSheet_(sheetName);
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var keyIdx = headers.indexOf(keyField);
  if (keyIdx === -1) throw new Error('Campo no encontrado: ' + keyField);
  for (var i = 1; i < values.length; i++) {
    if (values[i][keyIdx] === keyValue) {
      Object.keys(fields).forEach(function (fieldName) {
        var colIdx = headers.indexOf(fieldName);
        if (colIdx !== -1) sh.getRange(i + 1, colIdx + 1).setValue(fields[fieldName]);
      });
      return true;
    }
  }
  return false;
}

function todayStr_() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

// ============================================================
// FIX DE FORMATO DE FECHAS (bug de autoconversión de Sheets)
// ============================================================
function forcePlainTextColumn_(sheetName, headerName) {
  var sh = getSheet_(sheetName);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var colIdx = headers.indexOf(headerName);
  if (colIdx === -1) return;
  var col = colIdx + 1;

  sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');

  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var range = sh.getRange(2, col, lastRow - 1, 1);
    var values = range.getValues();
    var changed = false;
    var fixed = values.map(function (row) {
      var v = row[0];
      if (Object.prototype.toString.call(v) === '[object Date]') {
        changed = true;
        return [Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd')];
      }
      return [v];
    });
    if (changed) range.setValues(fixed);
  }
}

function arreglarFormatoFechas() {
  forcePlainTextColumn_(SHEETS.RESPUESTAS, 'fecha');
  forcePlainTextColumn_(SHEETS.CAJA, 'fecha');
  forcePlainTextColumn_(SHEETS.INVENTARIO, 'fecha');
  forcePlainTextColumn_(SHEETS.AGUA, 'fecha');
  Logger.log('Formato de fechas corregido en Respuestas, CajaCierre, InventarioCierre y LecturasAgua.');
}

// ⚠️ DESTRUCTIVO: borra todo lo capturado hasta ahora (respuestas, ítems,
// incidencias, fotos, caja, inventario, lecturas de agua). NO toca Usuarios,
// Sucursales, Areas, Checklists ni ChecklistItems.
function limpiarDatosDePrueba() {
  [SHEETS.RESPUESTAS, SHEETS.RESP_ITEMS, SHEETS.INCIDENCIAS, SHEETS.FOTOS, SHEETS.CAJA, SHEETS.INVENTARIO, SHEETS.AGUA].forEach(function (name) {
    var sh = getSheet_(name);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  });
  Logger.log('Datos de prueba eliminados. Usuarios, sucursales, áreas y checklists quedaron intactos.');
}
