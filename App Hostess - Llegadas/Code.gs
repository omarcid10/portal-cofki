/**
 * Backend de Google Sheets para "Cofki Pueblo Serena · Lista de Espera".
 *
 * INSTALACIÓN:
 * 1. Crea un Google Sheet nuevo y vacío (ej. "Cofki Pueblo Serena - Data").
 * 2. Extensiones > Apps Script.
 * 3. Borra el contenido de Code.gs por defecto y pega TODO este archivo.
 * 4. En la barra de herramientas del editor, selecciona la función "setup" en el
 *    menú desplegable y da clic en ▶ Ejecutar (te va a pedir permisos, acéptalos).
 *    Esto crea las pestañas "Estado" e "Historial" en tu Sheet.
 * 5. Implementar > Nueva implementación > selecciona tipo "Aplicación web".
 *      - Ejecutar como: Yo
 *      - Quién tiene acceso: Cualquier usuario
 * 6. Copia la URL que termina en /exec.
 * 7. Pégala en el archivo HTML de la app, en la variable APPS_SCRIPT_URL.
 *
 * Cada vez que edites este código después de una implementación existente,
 * usa Implementar > Administrar implementaciones > ✏️ > Nueva versión, para
 * que los cambios se reflejen en la URL ya publicada.
 */

var SHEET_STATE_NAME = 'Estado';
var SHEET_HIST_NAME = 'Historial';
var HIST_HEADERS = ['Turno','Nombre','Telefono','Adultos','Niños','Total','Notas','Llegada','Estado','Mesa Asignada','Hora Asignación','Hora Sentado','Hora Finalizado','Hora Retiro','Asignación Manual'];

function setup(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var estado = ss.getSheetByName(SHEET_STATE_NAME) || ss.insertSheet(SHEET_STATE_NAME);
  estado.clear();
  estado.getRange(1,1,1,2).setValues([['key','value']]);
  estado.getRange(2,1,1,2).setValues([['state','']]);
  estado.setColumnWidth(2, 600);

  var hist = ss.getSheetByName(SHEET_HIST_NAME) || ss.insertSheet(SHEET_HIST_NAME);
  hist.clear();
  hist.getRange(1,1,1,HIST_HEADERS.length).setValues([HIST_HEADERS]);
  hist.setFrozenRows(1);

  SpreadsheetApp.getUi().alert('Listo. Pestañas "Estado" e "Historial" creadas. Ahora ve a Implementar > Nueva implementación.');
}

function doGet(e){
  var action = e.parameter.action;
  if(action === 'getState'){
    return jsonOut(readState());
  }
  return jsonOut({error:'acción no reconocida'});
}

function doPost(e){
  var body;
  try{
    body = JSON.parse(e.postData.contents);
  }catch(err){
    return jsonOut({error:'JSON inválido'});
  }
  if(body.action === 'saveState'){
    writeState(body.state);
    return jsonOut({ok:true});
  }
  return jsonOut({error:'acción no reconocida'});
}

function readState(){
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STATE_NAME);
  if(!sheet) return null;
  var raw = sheet.getRange(2,2).getValue();
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(err){ return null; }
}

function writeState(state){
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_STATE_NAME);
    sheet.getRange(2,2).setValue(JSON.stringify(state));
    writeHistorial(state);
  } finally {
    lock.releaseLock();
  }
}

// Refleja todos los clientes (turnos) del estado actual como filas legibles,
// para que puedas abrir el Sheet y ver/exportar el historial de la sucursal.
function writeHistorial(state){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hist = ss.getSheetByName(SHEET_HIST_NAME);
  if(!hist) return;
  var lastRow = hist.getLastRow();
  if(lastRow > 1){
    hist.getRange(2,1,lastRow-1,HIST_HEADERS.length).clearContent();
  }
  var clients = (state.clients || []).slice().sort(function(a,b){ return a.turno - b.turno; });
  var rows = clients.map(function(c){
    return [
      c.turno, c.name, c.phone, c.adults, c.kids, c.total, c.notes,
      c.arrivalTime || '', c.status, c.assignedUnitName || '',
      c.assignedTime || '', c.seatedTime || '', c.finishedTime || '', c.leftTime || '',
      c.manual ? 'Sí' : 'No'
    ];
  });
  if(rows.length){
    hist.getRange(2,1,rows.length,HIST_HEADERS.length).setValues(rows);
  }
}

function jsonOut(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
