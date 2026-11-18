function json(statusCode, obj, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) },
    body: JSON.stringify(obj),
  };
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

// Envuelve un handler: errores inesperados => 503 sin filtrar detalles al navegador.
function safe(fn) {
  return async (event) => {
    try {
      return await fn(event);
    } catch (err) {
      console.error('portal error:', err && err.message);
      return json(503, { error: 'Servicio no disponible. Intenta de nuevo en unos segundos.' });
    }
  };
}

module.exports = { json, parseBody, safe };
