/**
 * AMIGO INVISIBLE · Conexión con Google
 * --------------------------------------
 * Pega este código en script.google.com estando dentro del Gmail del sorteo.
 * Guarda los datos de la app en Google Drive y envía los correos desde ese Gmail.
 *
 * 1) Cambia la CLAVE de abajo por una contraseña tuya (la pondrás también en la app).
 * 2) Implementar → Nueva implementación → Tipo: Aplicación web
 *      Ejecutar como: Yo   ·   Quién tiene acceso: Cualquier usuario
 * 3) Copia la URL que termina en /exec y pégala en la app (Ajustes).
 */
const CLAVE = 'cambia-esta-clave';

const ARCHIVO = 'amigo-invisible-datos.json';

function doGet(e) { return responder(atender(e.parameter || {})); }
function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { return responder({ ok: false, error: 'Petición no válida' }); }
  return responder(atender(p));
}

function atender(p) {
  if (p.clave !== CLAVE) return { ok: false, error: 'Clave incorrecta' };
  try {
    switch (p.accion) {
      case 'leer':    return { ok: true, datos: leer() };
      case 'guardar': guardar(p.datos); return { ok: true };
      case 'enviar':
        GmailApp.sendEmail(p.to, p.subject, p.message, { htmlBody: p.html, name: 'Amigo invisible' });
        return { ok: true };
      case 'cuota':   return { ok: true, restantes: MailApp.getRemainingDailyQuota() };
      default:        return { ok: true, hola: 'Conexión correcta 🎄' };
    }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function archivo() {
  const it = DriveApp.getFilesByName(ARCHIVO);
  return it.hasNext() ? it.next() : null;
}
function leer() {
  const f = archivo();
  return f ? JSON.parse(f.getBlob().getDataAsString()) : null;
}
function guardar(datos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const txt = JSON.stringify(datos);
    const f = archivo();
    if (f) f.setContent(txt); else DriveApp.createFile(ARCHIVO, txt, 'application/json');
  } finally { lock.releaseLock(); }
}
function responder(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Ejecuta esta función una vez desde el editor para dar permisos (Gmail y Drive). */
function darPermisos() {
  Logger.log('Correos que puedes enviar hoy: ' + MailApp.getRemainingDailyQuota());
  Logger.log('Datos guardados: ' + (archivo() ? 'sí' : 'todavía no'));
}
