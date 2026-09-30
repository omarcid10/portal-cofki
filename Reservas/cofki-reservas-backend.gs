/**
 * cofki · Backend de reservas
 * -----------------------------------------------------------
 * 1. Extensiones > Apps Script en tu Google Sheet, borra el
 *    contenido de Code.gs y pega TODO este archivo.
 * 2. Guarda (icono de disco).
 * 3. Deploy > New deployment > tipo "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 4. Copia la URL que termina en /exec y pégala como SCRIPT_URL
 *    en cofki-reservas.html y en cofki-reservas-admin.html.
 * -----------------------------------------------------------
 * Para futuras ediciones de este script: Deploy > Manage
 * deployments > lápiz > "New version" > Deploy. Así la URL
 * /exec se mantiene igual y no tienes que volver a pegarla.
 */

var SHEET_NAME = 'Reservas';
var HEADERS = ['Timestamp', 'ID', 'Fecha', 'Hora', 'HoraLabel', 'Sucursal', 'Adultos', 'Niños', 'Nombre', 'Celular', 'Celebración', 'DetalleCelebración'];

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'create') return createReservation(e);
  if (action === 'list') return listReservations();
  return jsonOutput({ success: false, error: 'Acción no reconocida' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function createReservation(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();

    var id = String(e.parameter.id || '');
    var date = String(e.parameter.date || '');
    var time = String(e.parameter.time || '');
    var timeLabel = String(e.parameter.timeLabel || '');
    var branch = String(e.parameter.branch || '');
    var adults = String(e.parameter.adults || '');
    var children = String(e.parameter.children || '');
    var name = String(e.parameter.name || '').trim();
    var phone = String(e.parameter.phone || '').replace(/\D/g, '');
    var celebration = String(e.parameter.celebration || 'Ninguna');
    var celebrationDetail = String(e.parameter.celebrationDetail || '').trim();

    if (!id || !date || !time || !branch || !name || phone.length !== 10) {
      return jsonOutput({ success: false, error: 'Datos incompletos o inválidos' });
    }

    var nextRow = sheet.getLastRow() + 1;

    // Forzar texto en columnas que Sheets podría malinterpretar
    // (fechas, horas y celular como número/fecha en vez de texto).
    sheet.getRange(nextRow, 3, 1, 1).setNumberFormat('@'); // Fecha
    sheet.getRange(nextRow, 4, 1, 1).setNumberFormat('@'); // Hora
    sheet.getRange(nextRow, 5, 1, 1).setNumberFormat('@'); // HoraLabel
    sheet.getRange(nextRow, 10, 1, 1).setNumberFormat('@'); // Celular

    sheet.getRange(nextRow, 1, 1, HEADERS.length).setValues([[
      new Date(), id, date, time, timeLabel, branch, adults, children, name, phone, celebration, celebrationDetail
    ]]);

    return jsonOutput({ success: true });
  } catch (err) {
    return jsonOutput({ success: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function listReservations() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOutput({ success: true, data: [] });

  var tz = Session.getScriptTimeZone();
  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var data = values
    .filter(function (row) { return row[1]; }) // debe tener ID
    .map(function (row) {
      return {
        createdAt: row[0] instanceof Date ? row[0].toISOString() : String(row[0]),
        id: String(row[1]),
        date: safeText_(row[2], tz, 'yyyy-MM-dd'),
        time: safeText_(row[3], tz, 'HH:mm'),
        timeLabel: safeText_(row[4], tz, 'h:mm a'),
        branch: String(row[5]),
        adults: String(row[6]),
        children: String(row[7]),
        name: String(row[8]),
        phone: String(row[9]),
        celebration: String(row[10] || 'Ninguna'),
        celebrationDetail: String(row[11] || '')
      };
    });

  return jsonOutput({ success: true, data: data });
}

// Convierte a texto de forma segura. Si Sheets guardó el valor como
// fecha/hora (aunque la celda se vea bien), lo formatea en vez de
// mostrar el objeto de fecha crudo.
function safeText_(value, tz, dateFormat) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, tz, dateFormat);
  }
  return String(value);
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
