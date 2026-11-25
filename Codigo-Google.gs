/**
 * AMIGO INVISIBLE · Conexión con Google
 * --------------------------------------
 * Pega este código en script.google.com estando dentro del Gmail del sorteo.
 * Guarda los datos en Google Drive, envía todos los correos desde ese Gmail,
 * atiende el cuestionario y la página "rasca y descubre", y hace las tareas
 * automáticas (recordatorios, sorteos programados, "¿qué regalaste?"...).
 *
 * Al actualizar:
 *  1) Cambia la CLAVE de abajo por tu contraseña (la misma de la app).
 *  2) Guarda 💾, elige la función darPermisos y pulsa ▶ Ejecutar (acepta los permisos nuevos).
 *  3) Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar.
 *  4) En la app: ⚙️ Ajustes → Tareas automáticas → Activar.
 */
const CLAVE = 'cambia-esta-clave';

const VERSION = '3.4';
const ARCHIVO = 'amigo-invisible-datos.json';
const MAX_PREGUNTAS = 15;          // por persona y año

/* ============================================================
   ENTRADA
   ============================================================ */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.t) return paginaAntigua(p.t);   // enlaces antiguos del cuestionario
  return responder(atender(p));
}
function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { return responder({ ok: false, error: 'Petición no válida' }); }
  return responder(atender(p));
}
function responder(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* Acciones públicas: las usan los familiares con su enlace secreto (sin clave) */
const PUBLICAS = {
  cuestionario: p => datosCuestionario(p.t),
  responder:    p => { guardarRespuestas(p.t, p.raw || {}, p.lista || [], p.ideas); return { ok: true }; },
  amigo:        p => datosAmigo(p.k),
  revelar:      p => { marcarLeido(p.k); return { ok: true }; },
  preguntar:    p => preguntar(p.k, p.texto),
  pregunta:     p => verPregunta(p.k, p.q),
  contestar:    p => contestar(p.k, p.q, p.texto),
  regalo:       p => guardarRegalo(p.k, p.que),
  asistencia:   p => guardarAsistencia(p.k, p.r),
  votacion:     p => datosVotacion(p.t),
  votar:        p => { guardarVoto(p.t, p.voto || {}); return datosVotacion(p.t); },
};

function atender(p) {
  try {
    if (PUBLICAS[p.accion]) return PUBLICAS[p.accion](p);
    if (p.clave !== CLAVE) return { ok: false, error: 'Clave incorrecta' };
    switch (p.accion) {
      case 'leer':              return { ok: true, datos: leer() };
      case 'guardar':           guardar(p.datos); return { ok: true };
      case 'enviar':            correo(p.to, p.subject, p.message, p.html); return { ok: true };
      case 'enviarResultado':   return enviarResultado(p.sid, p.anio, p.pid);
      case 'enviarCuestionario':return enviarCuestionario(p.sid, p.pid, false);
      case 'prueba':            return correoPrueba(p.to, p.sid);
      case 'activarPreguntas':  return activarPreguntas(p.sid);
      case 'encuestaRegalo':    return encuestaRegalo(p.sid);
      case 'preguntarAsistencia': return preguntarAsistencia(p.sid);
      case 'enviarVotacion':    return enviarVotacion(p.sid);
      case 'plantillas':        return { ok: true, efectivos: cuestionarios(leer()), defecto: CUESTIONARIOS };
      case 'estadisticas':      return estadisticas(p.sid);
      case 'estado':            return estado();
      case 'instalarTareas':    instalarTareas(); return estado();
      case 'limpiar':           return { ok: true, borrados: limpiarEnviados(true) };
      case 'cuota':             return { ok: true, restantes: MailApp.getRemainingDailyQuota() };
      default:                  return { ok: true, hola: 'Conexión correcta 🎄', version: VERSION };
    }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/* ============================================================
   DATOS EN DRIVE
   ============================================================ */
function archivo() {
  const it = DriveApp.getFilesByName(ARCHIVO);
  return it.hasNext() ? it.next() : null;
}
function leer() {
  const f = archivo();
  return f ? JSON.parse(f.getBlob().getDataAsString()) : null;
}
function escribir(datos) {
  const txt = JSON.stringify(datos);
  const f = archivo();
  if (f) f.setContent(txt); else DriveApp.createFile(ARCHIVO, txt, 'application/json');
}
/* Lee, cambia y guarda con candado (para que dos cambios a la vez no se pisen) */
function conDatos(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const d = leer();
    const r = fn(d);
    d.rev = Date.now();
    escribir(d);
    return r;
  } finally { lock.releaseLock(); }
}

/* Guarda lo que manda la app sin perder lo que haya cambiado Google mientras tanto
   (respuestas del cuestionario, correos enviados, leídos, regalos, tareas hechas). */
function guardar(datos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const actual = leer();
    if (actual && actual.sorteos && datos && datos.sorteos) mezclar(actual, datos);
    escribir(datos);
  } finally { lock.releaseLock(); }
}
function mezclar(actual, nuevo) {
  const pAct = {}, sAct = {};
  actual.sorteos.forEach(s => { sAct[s.id] = s; (s.personas || []).forEach(p => { pAct[p.id] = p; }); });
  nuevo.sorteos.forEach(s => {
    (s.personas || []).forEach(p => {
      const a = pAct[p.id]; if (!a) return;
      if (a.respondido && (!p.respondido || a.respondido > p.respondido)) { p.respuestas = a.respuestas; p.respondido = a.respondido; }
      if ((a.ideasAt || '') > (p.ideasAt || '')) { p.ideas = a.ideas; p.ideasAt = a.ideasAt; }
      if (a.regalos) p.regalos = a.regalos;
      if (a.cuestEnviado && (!p.cuestEnviado || a.cuestEnviado > p.cuestEnviado)) p.cuestEnviado = a.cuestEnviado;
      if (a.asistencia && (!p.asistencia || (a.asistencia.f || '') > (p.asistencia.f || ''))) p.asistencia = a.asistencia;
    });
    const sa = sAct[s.id]; if (!sa) return;
    (s.recordatorios || []).forEach(r => { const ra = (sa.recordatorios || []).find(x => x.fecha === r.fecha); if (ra && ra.hecho) { r.hecho = ra.hecho; r.enviados = ra.enviados; } });
    if (s.encuestaRegalo && sa.encuestaRegalo && sa.encuestaRegalo.hecho && s.encuestaRegalo.fecha === sa.encuestaRegalo.fecha) s.encuestaRegalo.hecho = sa.encuestaRegalo.hecho;
    if (s.vispera && sa.vispera && sa.vispera.hecho && s.vispera.cuando === sa.vispera.cuando) s.vispera.hecho = sa.vispera.hecho;
    if (sa.asistenciaPreguntada && !s.asistenciaPreguntada) s.asistenciaPreguntada = sa.asistenciaPreguntada;
    if (sa.votacion && s.votacion && sa.votacion.id === s.votacion.id) {   // los votos los escribe Google
      s.votacion.votos = Object.assign({}, s.votacion.votos || {}, sa.votacion.votos || {});
      if (sa.votacion.enviada && !s.votacion.enviada) s.votacion.enviada = sa.votacion.enviada;
    }
    (s.historial || []).forEach(h => {
      const ha = (sa.historial || []).find(x => (h.id && x.id === h.id) || (!h.id && x.anio === h.anio && x.enc === h.enc));
      if (!ha) return;
      if (ha.enc !== h.enc) return;   // la app ha reajustado el sorteo (altas/bajas): manda lo de la app
      h.enviados = Object.assign({}, h.enviados || {}, ha.enviados || {});
      h.leidos = Object.assign({}, h.leidos || {}, ha.leidos || {});
      if (ha.estado === 'enviado') h.estado = 'enviado';
      if (ha.preguntasEnviadas) h.preguntasEnviadas = ha.preguntasEnviadas;
    });
  });
}

/* ============================================================
   UTILIDADES
   ============================================================ */
const PROPS = () => PropertiesService.getScriptProperties();
const ahoraISO = () => new Date().toISOString();
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enlazar = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2c7fb8">$1</a>');
const emailValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
const listaIdeas = t => String(t || '').split(/\n|;|•/).map(x => x.replace(/^\s*[-*·]\s*/, '').trim()).filter(Boolean);
const anioActual = () => new Date().getFullYear();
const respondidoEsteAnio = p => !!(p.respondido && +String(p.respondido).slice(0, 4) === anioActual());

function correo(to, subject, texto, html) {
  MailApp.sendEmail({ to: to, subject: subject, body: texto, htmlBody: html, name: 'Amigo invisible' });
}

/* Resultados codificados (igual que en la app) */
function keyBytes(salt) { const out = []; let h = 2166136261; for (let i = 0; i < 256; i++) { h ^= salt.charCodeAt(i % salt.length) + i; h = Math.imul(h, 16777619) >>> 0; out.push(h & 255); } return out; }
function dec(str, salt) {
  try {
    const k = keyBytes(salt), raw = Utilities.base64Decode(str);
    const out = raw.map((b, i) => { const v = (b & 255) ^ k[i % k.length]; return v > 127 ? v - 256 : v; });
    return JSON.parse(Utilities.newBlob(out).getDataAsString('UTF-8'));
  } catch (e) { return {}; }
}

function buscarSorteo(d, sid) { return (d.sorteos || []).find(s => s.id === sid); }
function opciones(s) { const o = s.opciones || {}; return { tema: (o.tema === 'cumple' ? 'invierno' : o.tema) || 'navidad', rasca: o.rasca !== false, preguntas: o.preguntas !== false }; }
/* El sorteo ya enviado más reciente (no cuenta uno programado que aún no se ha mandado) */
function registroActual(s) {
  return (s.historial || []).filter(h => h.estado !== 'programado').sort((a, b) => b.anio - a.anio)[0] || null;
}
function fechaTexto(ev) {
  if (!ev || !ev.fecha) return 'por decidir';
  const d = new Date(ev.fecha + 'T12:00:00');
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  let t = dias[d.getDay()] + ', ' + d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
  if (ev.hora) t += ' a las ' + ev.hora;
  return t;
}
/* Presupuesto: mínimo y/o máximo. Solo mínimo → "mínimo 25 €"; los dos → "entre 25 y 50 €" */
function presupuestoTexto(ev){
  ev = ev || {};
  const n = v => String(v == null ? '' : v).trim().replace(/\s*€$/, '');
  const e = v => /\d$/.test(v) ? v + ' €' : v;
  const mn = n(ev.presMin), mx = n(ev.presMax);
  if (mn && mx) return 'entre ' + mn + ' y ' + e(mx);
  if (mn) return 'mínimo ' + e(mn);
  if (mx) return 'máximo ' + e(mx);
  const p = n(ev.presupuesto); return p ? e(p) : 'sin límite';
}
function enlacePagina(d, pagina, params) {
  const base = String(d.appUrl || '').replace(/[^/]*$/, '');
  const q = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  return base + pagina + '?' + q + '&u=' + encodeURIComponent(d.scriptUrl || ScriptApp.getService().getUrl());
}

/* ---------- Enlaces secretos (se guardan aparte, la app no los ve) ---------- */
function secretoDe(sid, pid) {
  const props = PROPS();
  let k = props.getProperty('pid_' + pid);
  if (!k) {
    k = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('pid_' + pid, k);
    props.setProperty('sec_' + k, JSON.stringify({ s: sid, p: pid }));
  }
  return k;
}
function porSecreto(d, k) {
  if (!k) return null;
  const v = PROPS().getProperty('sec_' + k);
  if (!v) return null;
  const o = JSON.parse(v);
  // Se busca a la persona en todos los sorteos (por si se ha cambiado de sorteo)
  const orden = [buscarSorteo(d, o.s)].concat(d.sorteos || []).filter(Boolean);
  for (const s of orden) { const p = (s.personas || []).find(x => x.id === o.p); if (p) return { s: s, p: p }; }
  return null;
}

/* ============================================================
   TEMAS Y CORREOS
   ============================================================ */
const TEMAS = {
  navidad: { emoji: '✨', titulo: 'Amigo invisible', fondo: '#14213d', cab: '#1d2d50', cabTexto: '#e5c07b', acento: '#e5c07b', claro: '#c9d3e6', papel: '#fbf8f1', tinta: '#1d2d50', nombre: '#b08a3e', fiesta: '¡Feliz Navidad!' },   // Noche dorada
  reyes:   { emoji: '👑', titulo: 'Amigo invisible de Reyes', fondo: '#211a44', cab: '#6b3fa0', acento: '#e9b44c', claro: '#ffd666', papel: '#fbf6ff', tinta: '#2a1840', fiesta: '¡Felices Reyes!' },
  invierno:{ emoji: '❄️', titulo: 'Amigo invisible de invierno', fondo: '#0b1530', cab: '#132147', cabTexto: '#8fe8cf', acento: '#5fd3b0', claro: '#e6f6ff', papel: '#eef4ff', tinta: '#0b1530', nombre: '#2f8f7a', fiesta: '¡Feliz invierno!' },   // Aurora boreal
};
const tema = s => TEMAS[opciones(s).tema] || TEMAS.navidad;

function marco(t, titulo, sub, cuerpo) {
  return '<div style="background:' + t.fondo + ';padding:24px 12px;font-family:Georgia,\'Times New Roman\',serif">' +
    '<div style="max-width:480px;margin:0 auto;background:' + t.papel + ';border-radius:18px;overflow:hidden;border:3px solid ' + t.acento + '">' +
    '<div style="background:' + t.cab + ';color:' + (t.cabTexto || '#fff') + ';text-align:center;padding:18px 12px;font-size:24px;letter-spacing:1px;border-bottom:2px solid ' + t.acento + '">' + titulo +
    '<div style="font-size:15px;color:' + t.claro + ';margin-top:4px">' + sub + '</div></div>' +
    '<div style="padding:22px 20px;color:' + t.tinta + ';font-size:17px;line-height:1.6;text-align:center">' + cuerpo + '</div>' +
    '<div style="background:' + t.acento + ';height:8px"></div></div>' +
    '<p style="text-align:center;color:#9fb8c2;font-size:12px;font-family:Arial,sans-serif">Este mensaje es solo para ti.</p></div>';
}
function boton(t, url, texto, color) {
  return '<a href="' + esc(url) + '" style="display:inline-block;background:' + (color || t.cab) + ';color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:12px;font-family:Arial,sans-serif;font-size:17px;margin:4px">' + texto + '</a>';
}

/* Gustos de una persona: ideas + cuestionario + edad + regalos de otros años */
function pistas(p, anio) {
  const ideas = listaIdeas(p.ideas);
  const resumen = ((p.respuestas && p.respuestas.lista) || []).filter(r => r && r.a);
  const extra = [];
  if (p.edad) extra.push({ q: 'Edad', a: p.edad + ' años' });
  const previos = (p.regalos || []).filter(r => r.anio < anio && r.que).sort((a, b) => b.anio - a.anio);
  if (previos.length) extra.push({ q: 'Regalos de otros años (para no repetir)', a: previos.map(r => r.anio + ': ' + r.que).join('\n') });
  return { ideas: ideas, resumen: extra.concat(resumen) };
}
function pistasHTML(t, pk) {
  let h = '';
  if (pk.ideas.length) h += '<div style="text-align:left;background:#ffffff;border:2px dashed ' + t.acento + ';border-radius:12px;padding:10px 14px;margin:8px 0;font-size:16px;line-height:1.5">' + pk.ideas.map(x => '🎁 ' + enlazar(x)).join('<br>') + '</div>';
  if (pk.resumen.length) h += '<div style="text-align:left;background:#ffffff;border:2px solid ' + t.acento + ';border-radius:12px;padding:10px 14px;margin:8px 0;font-size:15px;line-height:1.45"><div style="font-weight:bold;color:' + t.cab + ';margin-bottom:4px">📋 Lo que ha contado</div>' +
    pk.resumen.map(r => '<div style="padding:5px 0;border-top:1px dashed #e4d3b4"><span style="color:#7a6a5a;font-size:13px">' + esc(r.q) + '</span><br><b>' + enlazar(r.a).replace(/\n/g, '<br>') + '</b></div>').join('') + '</div>';
  return h || '<i>Esta vez no hay pistas: ¡sorpréndele!</i>';
}
function pistasTexto(pk) {
  const L = pk.ideas.map(x => '• ' + x).concat(pk.resumen.map(r => '• ' + r.q + ': ' + r.a));
  return L.length ? L.join('\n') : 'Esta vez no hay pistas: ¡sorpréndele!';
}
function rellenar(tpl, v) { return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)); }

/* ---------- Correo del resultado ---------- */
function enviarResultado(sid, anio, pid) {
  const d = leer(), s = buscarSorteo(d, sid);
  if (!s) throw new Error('Sorteo no encontrado');
  const h = (s.historial || []).find(x => x.anio == anio);
  if (!h) throw new Error('No hay sorteo de ' + anio);
  correoResultado(d, s, h, pid);
  conDatos(dd => { const hh = (buscarSorteo(dd, sid).historial || []).find(x => x.anio == anio); if (hh) { hh.enviados = hh.enviados || {}; hh.enviados[pid] = true; } });
  limpiarEnviados(false);
  return { ok: true };
}
function correoResultado(d, s, h, pid) {
  const pares = dec(h.enc, s.salt), p = s.personas.find(x => x.id === pid), a = s.personas.find(x => x.id === pares[pid]);
  if (!p || !a) throw new Error('Persona no encontrada');
  if (!emailValido(p.email)) throw new Error('Correo no válido de ' + p.nombre);
  const t = tema(s), op = opciones(s), ev = s.evento || {};
  const k = secretoDe(s.id, p.id);
  const urlVer = enlacePagina(d, 'amigo.html', { k: k });
  const pk = pistas(a, h.anio);
  const v = { nombre: p.nombre, sorteo: s.nombre, fecha: fechaTexto(ev), lugar: ev.lugar || 'por decidir', presupuesto: presupuestoTexto(ev) };
  let tpl = String(ev.mensaje || '');
  let html, texto;
  if (op.rasca) {
    // El nombre no va en el correo: se descubre rascando en la página
    tpl = tpl.replace(/\n?[^\n]*\{ideas\}[^\n]*/g, '');
    const cuerpo = esc(rellenar(tpl, Object.assign({}, v, { amigo: '\u0000' }))).replace(/\n/g, '<br>')
      .replace('\u0000', '<span style="display:inline-block;background:#ccc;color:#ccc;border-radius:8px;padding:2px 18px;font-size:22px">★ ★ ★</span>');
    html = marco(t, t.emoji + ' ' + t.titulo + ' ' + t.emoji, esc(s.nombre), cuerpo +
      '<br><br><b>¿Quién será? Pulsa el botón y rasca para descubrirlo 👇</b><br><br>' + boton(t, urlVer, '🎁 Descubrir a mi amigo invisible') +
      '<br><span style="font-size:13px;color:#7a6a5a">Allí verás también sus gustos' + (op.preguntas ? ' y podrás hacerle preguntas sin que sepa que eres tú' : '') + '.</span>');
    texto = rellenar(tpl, Object.assign({}, v, { amigo: '★ ★ ★' })) + '\n\nDescubre a tu amigo invisible aquí: ' + urlVer;
  } else {
    if (!tpl.includes('{ideas}') && (pk.ideas.length || pk.resumen.length)) tpl += '\n\n💡 Pistas sobre sus gustos:\n{ideas}';
    const cuerpo = esc(tpl).replace(/\{(\w+)\}/g, (m, key) => {
      if (key === 'ideas') return '\u0001';
      if (key === 'amigo') return '<span style="display:inline-block;font-size:28px;font-weight:bold;color:' + (t.nombre || t.cab) + ';padding:4px 0">' + esc(a.nombre) + '</span>';
      return key in v ? '<b>' + esc(v[key]) + '</b>' : m;
    }).replace(/\n/g, '<br>').replace('\u0001', pistasHTML(t, pk));
    html = marco(t, t.emoji + ' ' + t.titulo + ' ' + t.emoji, esc(s.nombre), cuerpo + '<br><br>' +
      boton(t, enlacePagina(d, 'amigo.html', { k: k, m: 'ok' }), '✅ Lo he recibido', '#2e8b57') +
      (op.preguntas ? boton(t, enlacePagina(d, 'amigo.html', { k: k, m: 'preguntar' }), '💬 Preguntarle algo (anónimo)') : ''));
    texto = rellenar(tpl, Object.assign({}, v, { amigo: a.nombre, ideas: pistasTexto(pk) }));
  }
  correo(p.email, rellenar(ev.asunto || 'Tu amigo invisible · {sorteo}', v), texto, html);
}

function correoPrueba(to, sid) {
  const d = leer() || {};
  const s0 = (sid && buscarSorteo(d, sid)) || (d.sorteos || [])[0] || {};
  const t = tema(s0);
  const pk = { ideas: ['Galletas de jengibre', 'Un gorro nuevo'], resumen: [{ q: 'Talla de camisetas', a: 'XL' }, { q: '¿Dorado o plateado?', a: 'Dorado' }] };
  const html = marco(t, t.emoji + ' ' + t.titulo + ' ' + t.emoji, 'Prueba', '¡Hola! Este es un correo de prueba.<br><br>Te ha tocado regalar a…<br><span style="font-size:28px;font-weight:bold;color:' + (t.nombre || t.cab) + '">Papá Noel</span><br><br>💡 Pistas:' + pistasHTML(t, pk));
  correo(to, 'Correo de prueba · Amigo invisible', 'Correo de prueba del amigo invisible.', html);
  limpiarEnviados(false);
  return { ok: true };
}

/* ---------- Cuestionario: correo con el enlace ---------- */
function enviarCuestionario(sid, pid, recordatorio) {
  const d = leer(), s = buscarSorteo(d, sid), p = s && s.personas.find(x => x.id === pid);
  if (!p) throw new Error('Persona no encontrada');
  if (!emailValido(p.email)) throw new Error('Correo no válido de ' + p.nombre);
  const t = tema(s), url = enlacePagina(d, 'cuestionario.html', { t: p.token });
  const ninos = p.cuestionario === 'ninos';
  const cuerpo = (recordatorio ? '¡Hola <b>' + esc(p.nombre) + '</b>! 🔔<br><br>Todavía no nos has contado qué te gusta. ¡Que no se le escape a tu amigo invisible!' :
    '¡Hola <b>' + esc(p.nombre) + '</b>! ' + t.emoji + '<br><br>Se acerca el amigo invisible <b>(' + esc(s.nombre) + ')</b>. Para que quien te regale acierte, cuéntanos qué te gusta.') +
    (ninos ? '<br><br>Si lo necesitas, rellénalo con ayuda de un adulto.' : '') +
    '<br><br>Son un par de minutos y no hace falta instalar nada.<br><br>' + boton(t, url, '🎁 Rellenar mis gustos') +
    '<br><br><span style="font-size:13px;color:#7a6a5a">Puedes volver a abrir el enlace para cambiar tus respuestas cuando quieras.</span>';
  correo(p.email, (recordatorio ? '🔔 Recuerda: ' : '') + 'Ayuda a tu amigo invisible a acertar · ' + s.nombre,
    'Hola ' + p.nombre + ', rellena tus gustos aquí (no hace falta instalar nada): ' + url,
    marco(t, '🎁 ¿Qué te gustaría?', esc(s.nombre), cuerpo));
  conDatos(dd => { const pp = buscarSorteo(dd, sid).personas.find(x => x.id === pid); if (pp) pp.cuestEnviado = ahoraISO(); });
  limpiarEnviados(false);
  return { ok: true };
}

/* ============================================================
   CUESTIONARIOS (se pueden editar desde la app)
   ============================================================ */
const OTROS = (n, t) => ({ id: 'otros' + n, q: 'Otros (' + t + ')', tipo: 'largo', ph: 'Escribe aquí cualquier otra cosa que se te ocurra…' });
const FINAL = (deseos) => ({ t: '✨ Para acertar seguro', p: [
  { id: 'ideas', q: deseos, tipo: 'ideas', ph: 'Una idea por línea' },
  { id: 'lista', q: 'Enlace a tu lista de deseos (Amazon, una tienda…), si tienes', tipo: 'enlace', ph: 'https://…' },
  { id: 'tengo', q: 'Cosas que ya tienes o que no quieres', tipo: 'largo', ph: 'Para que no te lo repitan' },
] });
const CUESTIONARIOS = {
  completo: { nombre: 'Mujer (completo)', secciones: [
    { t: '🎁 Lo que más te gusta', p: [
      { id: 'ilusion', q: '¿Qué te haría más ilusión recibir?', tipo: 'multi', o: ['Ropa', 'Bisutería y accesorios', 'Bolsos', 'Maquillaje', 'Cuidado de la cara y el cuerpo', 'Perfume', 'Pijamas y ropa de casa', 'Decoración y hogar', 'Libros', 'Deporte', 'Tecnología', 'Manualidades', 'Cocina y repostería', 'Comida y dulces', 'LEGO', 'Juegos de mesa', 'Experiencias (spa, cena, entradas)'] },
      OTROS(0, 'Lo que más te gusta')] },
    { t: '👗 Ropa', p: [
      { id: 'talla', q: 'Talla de camisetas, jerséis y sudaderas', tipo: 'uno', o: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
      { id: 'pantalon', q: 'Talla de pantalón', tipo: 'texto', ph: '38' },
      { id: 'pie', q: 'Número de calzado', tipo: 'texto', ph: '38' },
      { id: 'estilo', q: '¿Cómo es tu estilo?', tipo: 'multi', o: ['Casual', 'Cómodo', 'Deportivo', 'Elegante', 'Clásico', 'Moderno', 'Bohemio'] },
      { id: 'colores', q: 'Colores que más te gustan', tipo: 'multi', o: ['Negro', 'Blanco', 'Beige y camel', 'Gris', 'Marrón', 'Azul marino', 'Azul claro', 'Verde', 'Rojo', 'Burdeos', 'Rosa', 'Lila', 'Tonos pastel', 'Estampados'] },
      { id: 'nocolores', q: 'Colores que no te pondrías', tipo: 'texto', ph: 'Amarillo, naranja…' },
      OTROS(1, 'Ropa')] },
    { t: '💍 Accesorios', p: [
      { id: 'metal', q: '¿Eres más de dorado o de plateado?', tipo: 'uno', o: ['Dorado', 'Plateado', 'Oro rosa', 'Me gustan todos'] },
      { id: 'accesorios', q: '¿Qué accesorios sueles llevar?', tipo: 'multi', o: ['Pendientes', 'Collares', 'Pulseras', 'Anillos', 'Reloj', 'Bolsos', 'Bufandas y pañuelos', 'Gorros y guantes', 'Pinzas y coleteros', 'Gafas de sol'] },
      { id: 'orejas', q: '¿Tienes agujeros en las orejas?', tipo: 'uno', o: ['Sí', 'No'] },
      { id: 'joyas', q: '¿Cómo te gusta la bisutería?', tipo: 'uno', o: ['Discreta y fina', 'Llamativa', 'Depende del día'] },
      OTROS(2, 'Accesorios')] },
    { t: '💄 Belleza y cuidado', p: [
      { id: 'piel', q: 'Tipo de piel', tipo: 'uno', o: ['Seca', 'Grasa', 'Mixta', 'Normal', 'Sensible'] },
      { id: 'maquillaje', q: '¿Usas maquillaje?', tipo: 'uno', o: ['A diario', 'A veces', 'Casi nunca'] },
      { id: 'tonos', q: 'Tonos de maquillaje que prefieres', tipo: 'multi', o: ['Naturales', 'Nude', 'Rosados', 'Rojos', 'Ahumados', 'Brillos'] },
      { id: 'aromas', q: 'Aromas que te gustan (perfumes, velas, cremas)', tipo: 'multi', o: ['Florales', 'Frutales', 'Dulces y vainilla', 'Frescos y cítricos', 'Amaderados', 'Sin perfume, por favor'] },
      { id: 'marcas', q: 'Marcas o productos que te encantan', tipo: 'texto', ph: 'Rituals, Sephora, The Ordinary…' },
      OTROS(3, 'Belleza y cuidado')] },
    { t: '🏡 Aficiones', p: [
      { id: 'aficiones', q: '¿Qué te gusta hacer en tu tiempo libre?', tipo: 'multi', o: ['Leer', 'Series y cine', 'Música', 'Cocinar', 'Repostería', 'Deporte', 'Pádel', 'Yoga y pilates', 'Viajar', 'Manualidades', 'Plantas', 'Mascotas', 'Fotografía', 'Juegos de mesa', 'Café y té', 'Vino'] },
      { id: 'favoritos', q: 'Libros, series, autores o grupos favoritos', tipo: 'texto', ph: '' },
      OTROS(4, 'Aficiones')] },
    FINAL('Ideas de regalo: cosas concretas que te encantaría recibir'),
  ] },
  sencillo: { nombre: 'Hombre (rápido)', secciones: [
    { t: '🎁 Lo que más te gusta', p: [
      { id: 'ilusion', q: '¿Qué te haría más ilusión recibir?', tipo: 'multi', o: ['Ropa', 'Deporte', 'Tecnología', 'Juegos de mesa', 'Videojuegos', 'LEGO y maquetas', 'Herramientas y bricolaje', 'Café', 'Cerveza o vino', 'Comida', 'Libros y cómics', 'Colonia y cuidado personal', 'Cosas de mi equipo', 'Experiencias'] },
      OTROS(0, 'Lo que más te gusta')] },
    { t: '👕 Ropa', p: [
      { id: 'talla', q: 'Talla de camisetas y sudaderas', tipo: 'uno', o: ['S', 'M', 'L', 'XL', 'XXL'] },
      { id: 'pie', q: 'Número de calzado', tipo: 'texto', ph: '43' },
      { id: 'colores', q: 'Colores que te gustan', tipo: 'multi', o: ['Negro', 'Gris', 'Azul marino', 'Azul', 'Verde', 'Beige', 'Blanco', 'Burdeos'] },
      OTROS(1, 'Ropa')] },
    { t: '⚽ Aficiones', p: [
      { id: 'equipo', q: 'Equipo o deporte favorito', tipo: 'texto', ph: 'Real Madrid, pádel…' },
      { id: 'aficiones', q: 'Otras aficiones', tipo: 'texto', ph: 'Carpintería, running, series…' },
      OTROS(2, 'Aficiones')] },
    FINAL('Ideas de regalo: cosas concretas que te gustaría recibir'),
  ] },
  ninos: { nombre: 'Niño/a (menor de 16)', secciones: [
    { t: '🎁 Lo que más te gusta', p: [
      { id: 'ilusion', q: '¿Qué te haría más ilusión recibir?', tipo: 'multi', o: ['Juguetes', 'LEGO', 'Juegos de mesa', 'Manualidades', 'Libros y cómics', 'Peluches', 'Muñecas y figuras', 'Coches y construcciones', 'Videojuegos', 'Deporte', 'Música', 'Ropa y complementos', 'Maquillaje y uñas', 'Material escolar bonito', 'Experiencias (cine, parque, actividad)'] },
      OTROS(0, 'Lo que más te gusta')] },
    { t: '🌟 Tus favoritos', p: [
      { id: 'personajes', q: 'Personajes, series o películas favoritas', tipo: 'texto', ph: '' },
      { id: 'idolos', q: 'Cantantes, youtubers o equipos favoritos', tipo: 'texto', ph: '' },
      { id: 'colores', q: 'Colores favoritos', tipo: 'multi', o: ['Rosa', 'Lila', 'Azul', 'Verde', 'Rojo', 'Amarillo', 'Negro', 'Blanco', 'Todos los colores'] },
      OTROS(1, 'Tus favoritos')] },
    { t: '👕 Ropa', p: [
      { id: 'talla', q: 'Talla de ropa', tipo: 'uno', o: ['8', '10', '12', '14', '16', 'XS', 'S', 'M'] },
      { id: 'pie', q: 'Número de calzado', tipo: 'texto', ph: '36' },
      OTROS(2, 'Ropa')] },
    FINAL('Ideas de regalo: cosas que te encantaría recibir'),
  ] },
};
function cuestionarios(d) {
  const c = (d && d.cuestionarios) || {};
  return { completo: c.completo || CUESTIONARIOS.completo, sencillo: c.sencillo || CUESTIONARIOS.sencillo, ninos: c.ninos || CUESTIONARIOS.ninos };
}

function buscarPorToken(d, token) {
  if (!d || !d.sorteos || !token) return null;
  for (const s of d.sorteos) for (const p of (s.personas || [])) if (p.token && p.token === token) return { s: s, p: p };
  return null;
}

function datosCuestionario(token) {
  const d = leer(), r = buscarPorToken(d, token);
  if (!r) return { ok: false, error: 'Enlace no válido' };
  const p = r.p, raw = (p.respuestas && p.respuestas.raw) || {};
  // Ideas: las de la ficha + las que se escribieron antes en "cosas concretas"
  const ideas = listaIdeas(p.ideas);
  listaIdeas(raw.deseos).forEach(x => { if (ideas.indexOf(x) < 0) ideas.push(x); });
  const anterior = p.respondido && !respondidoEsteAnio(p) ? +String(p.respondido).slice(0, 4) : null;
  return { ok: true, nombre: p.nombre, tipo: p.cuestionario || '', edad: p.edad || null, raw: raw, ideas: ideas.join('\n'),
    anterior: anterior, tema: opciones(r.s).tema, cuestionarios: cuestionarios(d) };
}

/* La llama la página del cuestionario al pulsar Guardar */
function guardarRespuestas(token, raw, lista, ideas) {
  const res = conDatos(d => {
    const r = buscarPorToken(d, token);
    if (!r) throw new Error('Enlace no válido');
    const p = r.p, ahora = ahoraISO(), correoP = String(p.email || '').trim().toLowerCase();
    lista = (lista || []).filter(x => x && x.q && x.a);
    d.sorteos.forEach(s => (s.personas || []).forEach(x => {
      if (x === p || (correoP && String(x.email || '').trim().toLowerCase() === correoP && x.nombre === p.nombre)) {
        x.respuestas = { raw: raw, lista: lista }; x.respondido = ahora;
        if (typeof ideas === 'string') { x.ideas = ideas.trim(); x.ideasAt = ahora; }
      }
    }));
    return { sid: r.s.id, pid: p.id };
  });
  avisarCambios(res.sid, res.pid);
}

/* Aviso a quien regala cuando su amigo invisible cambia sus gustos (después del sorteo) */
function avisarCambios(sid, pid) {
  const props = PROPS(), clave = 'aviso_' + pid, ultimo = +props.getProperty(clave) || 0;
  if (Date.now() - ultimo < 30 * 60 * 1000) return;              // como mucho uno cada media hora
  const d = leer(), s = buscarSorteo(d, sid), h = s && registroActual(s);
  if (!h || h.anio < anioActual()) return;
  const pares = dec(h.enc, s.salt), gid = Object.keys(pares).find(g => pares[g] === pid);
  const g = gid && s.personas.find(x => x.id === gid), a = s.personas.find(x => x.id === pid);
  if (!g || !a || !emailValido(g.email)) return;
  const t = tema(s), url = enlacePagina(d, 'amigo.html', { k: secretoDe(s.id, g.id), m: 'ver' });
  correo(g.email, '📝 Tu amigo invisible ha actualizado sus gustos · ' + s.nombre,
    'Hola ' + g.nombre + ', ' + a.nombre + ' ha actualizado sus gustos:\n\n' + pistasTexto(pistas(a, h.anio)),
    marco(t, '📝 ¡Novedades!', esc(s.nombre), '¡Hola <b>' + esc(g.nombre) + '</b>!<br><br><b>' + esc(a.nombre) + '</b>, tu amigo invisible, ha actualizado sus gustos. Así quedan ahora:' + pistasHTML(t, pistas(a, h.anio)) + '<br>' + boton(t, url, '🎁 Ver su página')));
  props.setProperty(clave, String(Date.now()));
  limpiarEnviados(false);
}

/* ============================================================
   PÁGINA DEL AMIGO INVISIBLE (rasca, preguntas, qué regalaste)
   ============================================================ */
function datosAmigo(k) {
  const d = leer(), r = porSecreto(d, k);
  if (!r) return { ok: false, error: 'Enlace no válido' };
  const s = r.s, p = r.p, h = registroActual(s);
  const base = { ok: true, nombre: p.nombre, sorteo: s.nombre, tema: opciones(s).tema };
  if (!h) return Object.assign(base, { sinSorteo: true });
  const pares = dec(h.enc, s.salt), a = s.personas.find(x => x.id === pares[p.id]);
  const ev = s.evento || {}, op = opciones(s);
  const preguntas = idsPreguntas('qg_' + p.id + '_' + h.anio).map(id => leerPregunta(id)).filter(q => q && a && q.r === a.id)
    .map(q => ({ texto: q.texto, respuesta: q.resp || '', fecha: q.f }));
  const recibidas = idsPreguntas('qr_' + p.id + '_' + h.anio).map(id => Object.assign({ id: id }, leerPregunta(id) || {})).filter(q => q.texto)
    .map(q => ({ id: q.id, texto: q.texto, respuesta: q.resp || '' }));
  const regalo = a && (a.regalos || []).find(x => x.anio === h.anio);
  return Object.assign(base, {
    anio: h.anio, amigo: a ? a.nombre : null, revelado: !!(h.leidos && h.leidos[p.id]),
    evento: { fecha: fechaTexto(ev), lugar: ev.lugar || 'por decidir', presupuesto: presupuestoTexto(ev) },
    pistas: a ? pistas(a, h.anio) : { ideas: [], resumen: [] },
    preguntasActivas: op.preguntas, preguntas: preguntas, recibidas: recibidas, maxPreguntas: MAX_PREGUNTAS,
    regalo: regalo ? regalo.que : '',
    asistencia: asisteEsteAnio(p, h.anio), amigoAsiste: a ? asisteEsteAnio(a, h.anio) : '',
  });
}
function marcarLeido(k) {
  conDatos(d => {
    const r = porSecreto(d, k); if (!r) throw new Error('Enlace no válido');
    const h = registroActual(r.s); if (!h) return;
    h.leidos = h.leidos || {}; if (!h.leidos[r.p.id]) h.leidos[r.p.id] = ahoraISO();
  });
}

/* ---------- Preguntas anónimas (se guardan aparte, fuera de los datos de la app) ---------- */
function idsPreguntas(clave) { try { return JSON.parse(PROPS().getProperty(clave) || '[]'); } catch (e) { return []; } }
function leerPregunta(id) { try { return JSON.parse(PROPS().getProperty('q_' + id) || 'null'); } catch (e) { return null; } }
function preguntar(k, texto) {
  texto = String(texto || '').trim().slice(0, 600);
  if (!texto) throw new Error('Escribe tu pregunta');
  const d = leer(), r = porSecreto(d, k); if (!r) throw new Error('Enlace no válido');
  const s = r.s, g = r.p, h = registroActual(s); if (!h) throw new Error('Todavía no hay sorteo');
  if (!opciones(s).preguntas) throw new Error('Las preguntas anónimas están desactivadas');
  const pares = dec(h.enc, s.salt), a = s.personas.find(x => x.id === pares[g.id]);
  if (!a || !emailValido(a.email)) throw new Error('No se puede enviar la pregunta');
  const lg = 'qg_' + g.id + '_' + h.anio, lr = 'qr_' + a.id + '_' + h.anio, ids = idsPreguntas(lg);
  if (ids.length >= MAX_PREGUNTAS) throw new Error('Ya has hecho ' + MAX_PREGUNTAS + ' preguntas este año');
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 16), props = PROPS();
  props.setProperty('q_' + id, JSON.stringify({ s: s.id, anio: h.anio, g: g.id, r: a.id, texto: texto, f: ahoraISO() }));
  props.setProperty(lg, JSON.stringify(ids.concat([id])));
  props.setProperty(lr, JSON.stringify(idsPreguntas(lr).concat([id])));
  const t = tema(s), url = enlacePagina(d, 'amigo.html', { k: secretoDe(s.id, a.id), m: 'responder', q: id });
  correo(a.email, '🤫 Tu amigo invisible te pregunta algo · ' + s.nombre,
    'Hola ' + a.nombre + ', tu amigo invisible te pregunta: "' + texto + '". Responde aquí: ' + url,
    marco(t, '🤫 Pregunta secreta', esc(s.nombre), '¡Hola <b>' + esc(a.nombre) + '</b>!<br><br>Tu amigo invisible te pregunta:<br><div style="background:#fff;border:2px dashed ' + t.acento + ';border-radius:12px;padding:12px;margin:12px 0;font-style:italic;font-size:18px">“' + esc(texto).replace(/\n/g, '<br>') + '”</div>' + boton(t, url, '✍️ Responder') + '<br><span style="font-size:13px;color:#7a6a5a">Nadie sabrá quién ha preguntado. Tampoco quien organiza.</span>'));
  limpiarEnviados(false);
  return { ok: true };
}
function verPregunta(k, qid) {
  const d = leer(), r = porSecreto(d, k), q = leerPregunta(qid);
  if (!r || !q || q.r !== r.p.id) return { ok: false, error: 'Enlace no válido' };
  return { ok: true, nombre: r.p.nombre, sorteo: r.s.nombre, tema: opciones(r.s).tema, texto: q.texto, respuesta: q.resp || '' };
}
function contestar(k, qid, texto) {
  texto = String(texto || '').trim().slice(0, 600);
  if (!texto) throw new Error('Escribe tu respuesta');
  const d = leer(), r = porSecreto(d, k), q = leerPregunta(qid);
  if (!r || !q || q.r !== r.p.id) throw new Error('Enlace no válido');
  q.resp = texto; q.fr = ahoraISO();
  PROPS().setProperty('q_' + qid, JSON.stringify(q));
  const s = r.s, g = s.personas.find(x => x.id === q.g);
  if (g && emailValido(g.email)) {
    const t = tema(s), url = enlacePagina(d, 'amigo.html', { k: secretoDe(s.id, g.id), m: 'preguntar' });
    correo(g.email, '💌 ' + r.p.nombre + ' ha respondido a tu pregunta · ' + s.nombre,
      'Preguntaste: "' + q.texto + '"\n' + r.p.nombre + ' responde: "' + texto + '"',
      marco(t, '💌 ¡Respuesta!', esc(s.nombre), 'Le preguntaste a <b>' + esc(r.p.nombre) + '</b>:<br><i>“' + esc(q.texto) + '”</i><br><br>Y te responde:<div style="background:#fff;border:2px solid ' + t.acento + ';border-radius:12px;padding:12px;margin:12px 0;font-size:18px">“' + esc(texto).replace(/\n/g, '<br>') + '”</div>' + boton(t, url, '💬 Preguntar otra cosa')));
    limpiarEnviados(false);
  }
  return { ok: true };
}
/* Enviar a todos el enlace de preguntas (para un sorteo que ya se hizo) */
function activarPreguntas(sid) {
  const d = leer(), s = buscarSorteo(d, sid), h = s && registroActual(s);
  if (!h) throw new Error('Todavía no hay sorteo');
  const pares = dec(h.enc, s.salt), t = tema(s); let n = 0;
  Object.keys(pares).forEach(gid => {
    const g = s.personas.find(x => x.id === gid); if (!g || !emailValido(g.email)) return;
    const url = enlacePagina(d, 'amigo.html', { k: secretoDe(s.id, g.id), m: 'preguntar' });
    correo(g.email, '💬 Ahora puedes preguntar a tu amigo invisible · ' + s.nombre,
      'Hola ' + g.nombre + ', ya puedes hacer preguntas a tu amigo invisible sin que sepa que eres tú: ' + url,
      marco(t, '💬 ¡Novedad!', esc(s.nombre), '¡Hola <b>' + esc(g.nombre) + '</b>!<br><br>¿Dudas con la talla o el color? Ahora puedes <b>preguntar a tu amigo invisible</b> sin que sepa que eres tú. La respuesta te llegará por correo.<br><br>En la misma página verás también sus gustos.<br><br>' + boton(t, url, '💬 Hacer una pregunta')));
    n++;
  });
  conDatos(dd => { const hh = registroActual(buscarSorteo(dd, sid)); if (hh) hh.preguntasEnviadas = ahoraISO(); });
  limpiarEnviados(false);
  return { ok: true, enviados: n };
}

/* ---------- ¿Vienes al reparto? ---------- */
function asisteEsteAnio(p, anio) { return (p.asistencia && p.asistencia.anio === anio) ? p.asistencia.resp : ''; }
function guardarAsistencia(k, resp) {
  if (['si', 'no', 'nose'].indexOf(resp) < 0) throw new Error('Respuesta no válida');
  conDatos(d => {
    const r = porSecreto(d, k); if (!r) throw new Error('Enlace no válido');
    const h = registroActual(r.s); if (!h) throw new Error('Todavía no hay sorteo');
    r.p.asistencia = { anio: h.anio, resp: resp, f: ahoraISO() };
  });
  return { ok: true };
}
function preguntarAsistencia(sid) {
  const d = leer(), s = buscarSorteo(d, sid), h = s && registroActual(s);
  if (!h) throw new Error('Todavía no hay sorteo');
  const pares = dec(h.enc, s.salt), t = tema(s), ev = s.evento || {}; let n = 0;
  Object.keys(pares).forEach(pid => {
    const p = s.personas.find(x => x.id === pid); if (!p || !emailValido(p.email)) return;
    const k = secretoDe(s.id, p.id), u = r => enlacePagina(d, 'amigo.html', { k: k, m: 'vienes', r: r });
    correo(p.email, '🙋 ¿Vienes al reparto? · ' + s.nombre,
      'Hola ' + p.nombre + ', ¿vienes al reparto del amigo invisible (' + fechaTexto(ev) + ', ' + (ev.lugar || 'lugar por decidir') + ')? Responde aquí: ' + u('si'),
      marco(t, '🙋 ¿Vienes al reparto?', esc(s.nombre), '¡Hola <b>' + esc(p.nombre) + '</b>!<br><br>📅 <b>' + esc(fechaTexto(ev)) + '</b><br>📍 <b>' + esc(ev.lugar || 'por decidir') + '</b><br><br>¿Vas a poder venir?<br><br>' +
        boton(t, u('si'), '🙋 Sí, voy', '#2e8b57') + boton(t, u('no'), '😔 No puedo', '#a33a3a') + boton(t, u('nose'), '🤔 Aún no lo sé', '#6b6455') +
        '<br><br><span style="font-size:13px;color:#7a6a5a">Si no puedes ir, quien te regala lo sabrá (sin que tú sepas quién es) para organizarse.</span>'));
    n++;
  });
  conDatos(dd => { buscarSorteo(dd, sid).asistenciaPreguntada = ahoraISO(); });
  limpiarEnviados(false);
  return { ok: true, enviados: n };
}
/* ---------- 🗳️ Votación de fecha y lugar ---------- */
function totalesVotacion(v) {
  const t = { fechas: {}, lugares: {}, votantes: Object.keys(v.votos || {}).length };
  (v.fechas || []).forEach(f => { t.fechas[f.id] = { si: 0, quiza: 0, no: 0 }; });
  (v.lugares || []).forEach(l => { t.lugares[l.id] = 0; });
  Object.values(v.votos || {}).forEach(vo => {
    Object.keys(vo.fechas || {}).forEach(id => { if (t.fechas[id] && t.fechas[id][vo.fechas[id]] !== undefined) t.fechas[id][vo.fechas[id]]++; });
    if (vo.lugar && t.lugares[vo.lugar] !== undefined) t.lugares[vo.lugar]++;
  });
  return t;
}
function datosVotacion(token) {
  const d = leer(), r = buscarPorToken(d, token);
  if (!r) return { ok: false, error: 'Enlace no válido' };
  const s = r.s, v = s.votacion, base = { ok: true, nombre: r.p.nombre, sorteo: s.nombre, tema: opciones(s).tema };
  if (!v || !v.abierta) return Object.assign(base, { cerrada: true, fecha: s.evento && s.evento.fecha ? fechaTexto(s.evento) : '', lugar: (s.evento && s.evento.lugar) || '' });
  return Object.assign(base, {
    fechas: (v.fechas || []).map(f => ({ id: f.id, texto: fechaTexto(f) })),
    lugares: (v.lugares || []).map(l => ({ id: l.id, nombre: l.nombre })),
    miVoto: (v.votos || {})[r.p.id] || null, totales: totalesVotacion(v), nota: v.nota || '',
  });
}
function guardarVoto(token, voto) {
  conDatos(d => {
    const r = buscarPorToken(d, token); if (!r) throw new Error('Enlace no válido');
    const v = r.s.votacion; if (!v || !v.abierta) throw new Error('La votación ya está cerrada');
    const fechas = {}; (v.fechas || []).forEach(f => { const x = (voto.fechas || {})[f.id]; if (['si', 'quiza', 'no'].indexOf(x) >= 0) fechas[f.id] = x; });
    const lugar = (v.lugares || []).some(l => l.id === voto.lugar) ? voto.lugar : '';
    v.votos = v.votos || {};
    v.votos[r.p.id] = { fechas: fechas, lugar: lugar, comentario: String(voto.comentario || '').trim().slice(0, 300), f: ahoraISO() };
  });
}
function enviarVotacion(sid) {
  const d = leer(), s = buscarSorteo(d, sid), v = s && s.votacion;
  if (!v || !v.abierta || !(v.fechas || []).length) throw new Error('Crea primero la votación con alguna fecha');
  const t = tema(s); let n = 0;
  (s.personas || []).filter(p => p.activo !== false && emailValido(p.email) && p.token).forEach(p => {
    const url = enlacePagina(d, 'votar.html', { t: p.token });
    correo(p.email, '🗳️ ¿Qué día os viene mejor? · ' + s.nombre,
      'Hola ' + p.nombre + ', vota qué días puedes para el reparto del amigo invisible: ' + url,
      marco(t, '🗳️ ¿Qué día te viene mejor?', esc(s.nombre), '¡Hola <b>' + esc(p.nombre) + '</b>! ' + t.emoji + '<br><br>Estamos buscando el día en que podamos juntarnos más para el reparto del amigo invisible.<br><br>Marca qué días puedes' + ((v.lugares || []).length ? ' y qué sitio prefieres' : '') + '. Es un momento.<br><br>' +
        boton(t, url, '🗳️ Votar') + '<br><br><span style="font-size:13px;color:#7a6a5a">Puedes cambiar tu voto cuando quieras con el mismo enlace.</span>'));
    n++;
  });
  conDatos(dd => { const vv = buscarSorteo(dd, sid).votacion; if (vv) vv.enviada = ahoraISO(); });
  limpiarEnviados(false);
  return { ok: true, enviados: n };
}

/* ---------- Recordatorio la víspera del reparto ---------- */
function recordatorioVispera(d, s) {
  const h = registroActual(s); if (!h) return 0;
  const pares = dec(h.enc, s.salt), t = tema(s), ev = s.evento || {}; let n = 0;
  Object.keys(pares).forEach(gid => {
    const g = s.personas.find(x => x.id === gid), a = s.personas.find(x => x.id === pares[gid]);
    if (!g || !a || !emailValido(g.email)) return;
    const url = enlacePagina(d, 'amigo.html', { k: secretoDe(s.id, g.id), m: 'ver' });
    const noViene = asisteEsteAnio(a, h.anio) === 'no';
    correo(g.email, '📅 ¡Mañana es el reparto! · ' + s.nombre,
      'Hola ' + g.nombre + ', mañana es el reparto del amigo invisible: ' + fechaTexto(ev) + ', ' + (ev.lugar || 'lugar por decidir') + '. ¡No olvides el regalo! ' + url,
      marco(t, '📅 ¡Mañana es el reparto!', esc(s.nombre), '¡Hola <b>' + esc(g.nombre) + '</b>! ' + t.emoji + '<br><br>📅 <b>' + esc(fechaTexto(ev)) + '</b><br>📍 <b>' + esc(ev.lugar || 'por decidir') + '</b><br>💶 Presupuesto: <b>' + esc(presupuestoTexto(ev)) + '</b><br><br>🎁 <b>¡No olvides el regalo!</b>' +
        (noViene ? '<br><br><div style="background:#fff3d6;border-radius:10px;padding:10px;font-size:15px">ℹ️ Tu amigo invisible ha dicho que <b>no podrá ir</b>. Organízate para hacerle llegar el regalo.</div>' : '') +
        '<br><br>' + boton(t, url, '🎁 Ver a quién le regalo')));
    n++;
  });
  return n;
}

/* ---------- "¿Qué regalaste?" ---------- */
function guardarRegalo(k, que) {
  que = String(que || '').trim().slice(0, 300);
  if (!que) throw new Error('Escribe qué regalaste');
  conDatos(d => {
    const r = porSecreto(d, k); if (!r) throw new Error('Enlace no válido');
    const h = registroActual(r.s); if (!h) throw new Error('Todavía no hay sorteo');
    const a = r.s.personas.find(x => x.id === dec(h.enc, r.s.salt)[r.p.id]); if (!a) throw new Error('Persona no encontrada');
    a.regalos = (a.regalos || []).filter(x => x.anio !== h.anio).concat([{ anio: h.anio, que: que }]);   // no se guarda quién lo regaló
  });
  return { ok: true };
}
function encuestaRegalo(sid) {
  const d = leer(), s = buscarSorteo(d, sid), h = s && registroActual(s);
  if (!h) throw new Error('Todavía no hay sorteo');
  const pares = dec(h.enc, s.salt), t = tema(s); let n = 0;
  Object.keys(pares).forEach(gid => {
    const g = s.personas.find(x => x.id === gid), a = s.personas.find(x => x.id === pares[gid]);
    if (!g || !a || !emailValido(g.email)) return;
    const url = enlacePagina(d, 'amigo.html', { k: secretoDe(s.id, g.id), m: 'regalo' });
    correo(g.email, '🎁 ¿Qué le regalaste a ' + a.nombre + '? · ' + s.nombre,
      'Hola ' + g.nombre + ', cuéntanos qué le regalaste a ' + a.nombre + ' para no repetirlo otro año: ' + url,
      marco(t, '🎁 ¿Qué regalaste?', esc(s.nombre), '¡Hola <b>' + esc(g.nombre) + '</b>! ' + t.emoji + '<br><br>¿Qué le regalaste a <b>' + esc(a.nombre) + '</b>?<br><br>Apúntalo y, otro año, a quien le toque regalarle lo sabrá para no repetirlo. No se guarda quién lo regaló.<br><br>' + boton(t, url, '✍️ Apuntar mi regalo')));
    n++;
  });
  conDatos(dd => { const ss = buscarSorteo(dd, sid); ss.encuestaRegalo = Object.assign({}, ss.encuestaRegalo || {}, { hecho: ahoraISO() }); });
  limpiarEnviados(false);
  return { ok: true, enviados: n };
}

/* ============================================================
   TAREAS AUTOMÁTICAS (cada 15 minutos)
   ============================================================ */
function instalarTareas() {
  ScriptApp.getProjectTriggers().forEach(tr => { if (tr.getHandlerFunction() === 'tareas') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('tareas').timeBased().everyMinutes(15).create();
}
function tareasActivas() { return ScriptApp.getProjectTriggers().some(tr => tr.getHandlerFunction() === 'tareas'); }
function estado() {
  return { ok: true, version: VERSION, tareas: tareasActivas(), restantes: MailApp.getRemainingDailyQuota() };
}
function tareas() {
  const d = leer(); if (!d || !d.sorteos) return;
  const ahora = Date.now();
  d.sorteos.forEach(s => {
    // 1) Sorteo programado
    (s.historial || []).filter(h => h.estado === 'programado' && h.programado && Date.parse(h.programado) <= ahora).forEach(h => {
      const pares = dec(h.enc, s.salt), hechos = Object.assign({}, h.enviados || {});
      Object.keys(pares).forEach(pid => { if (hechos[pid]) return; try { correoResultado(d, s, h, pid); hechos[pid] = true; } catch (e) { hechos[pid] = false; } });
      conDatos(dd => { const hh = (buscarSorteo(dd, s.id).historial || []).find(x => x.id === h.id); if (hh) { hh.enviados = Object.assign({}, hh.enviados || {}, hechos); hh.estado = 'enviado'; hh.enviadoEn = ahoraISO(); } });
    });
    // 2) Recordatorios del cuestionario
    (s.recordatorios || []).forEach(rc => {
      if (!rc.fecha || rc.hecho || Date.parse(rc.fecha) > ahora) return;
      const pendientes = (s.personas || []).filter(p => p.activo !== false && !respondidoEsteAnio(p) && emailValido(p.email) && p.token);
      let n = 0; pendientes.forEach(p => { try { enviarCuestionario(s.id, p.id, true); n++; } catch (e) {} });
      conDatos(dd => { const rr = (buscarSorteo(dd, s.id).recordatorios || []).find(x => x.fecha === rc.fecha); if (rr) { rr.hecho = ahoraISO(); rr.enviados = n; } });
    });
    // 3) Recordatorio la víspera
    const vp = s.vispera;
    if (vp && vp.activo && vp.cuando && !vp.hecho && Date.parse(vp.cuando) <= ahora && Date.parse(vp.cuando) > ahora - 36 * 3600 * 1000) {
      let n = 0; try { n = recordatorioVispera(d, s); } catch (e) {}
      conDatos(dd => { const ss = buscarSorteo(dd, s.id); if (ss.vispera && ss.vispera.cuando === vp.cuando) { ss.vispera.hecho = ahoraISO(); ss.vispera.enviados = n; } });
    }
    // 4) "¿Qué regalaste?"
    const er = s.encuestaRegalo;
    if (er && er.fecha && !er.hecho && Date.parse(er.fecha) <= ahora) { try { encuestaRegalo(s.id); } catch (e) {} }
  });
  limpiarEnviados(false);
}

/* ---------- Borrar los correos de "Enviados" ---------- */
function limpiarEnviados(todo) {
  const d = leer();
  if (!todo && d && d.ajustes && d.ajustes.borrarEnviados === false) return 0;
  let n = 0;
  for (let i = 0; i < 20; i++) {
    const hilos = GmailApp.search(todo ? 'in:sent' : 'in:sent newer_than:2d', 0, 100);
    if (!hilos.length) break;
    GmailApp.moveThreadsToTrash(hilos); n += hilos.length;
    if (hilos.length < 100) break;
  }
  return n;
}

/* ---------- Números para el resumen (sin revelar parejas) ---------- */
function estadisticas(sid) {
  const d = leer(), s = buscarSorteo(d, sid), h = s && registroActual(s);
  if (!h) return { ok: true, preguntas: 0, respondidas: 0 };
  let preguntas = 0, respondidas = 0;
  Object.keys(dec(h.enc, s.salt)).forEach(gid => idsPreguntas('qg_' + gid + '_' + h.anio).forEach(id => { const q = leerPregunta(id); if (q) { preguntas++; if (q.resp) respondidas++; } }));
  return { ok: true, preguntas: preguntas, respondidas: respondidas };
}

/* ---------- Enlaces antiguos del cuestionario (script.google.com/...?t=) ---------- */
function paginaAntigua(token) {
  const d = leer() || {};
  const url = enlacePagina(d, 'cuestionario.html', { t: token });
  return HtmlService.createHtmlOutput('<div style="font-family:Arial;text-align:center;padding:40px 16px"><h2>🎁 Tu cuestionario se ha mudado</h2><p><a target="_top" href="' + esc(url) + '" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:bold">Abrir mi cuestionario</a></p></div>')
    .setTitle('Amigo invisible').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Ejecuta esta función desde el editor después de cada actualización para dar los permisos. */
function darPermisos() {
  Logger.log('Correos que puedes enviar hoy: ' + MailApp.getRemainingDailyQuota());
  Logger.log('Datos guardados: ' + (archivo() ? 'sí' : 'todavía no'));
  Logger.log('Tareas automáticas: ' + (tareasActivas() ? 'activas' : 'sin activar'));
  Logger.log('Correos en Enviados: ' + GmailApp.search('in:sent', 0, 1).length);
  Logger.log('Versión: ' + VERSION);
}
