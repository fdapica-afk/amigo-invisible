/**
 * AMIGO INVISIBLE · Conexión con Google
 * --------------------------------------
 * Pega este código en script.google.com estando dentro del Gmail del sorteo.
 * Guarda los datos de la app en Google Drive, envía los correos desde ese Gmail
 * y muestra el cuestionario de gustos a cada familiar (sin instalar nada).
 *
 * 1) Cambia la CLAVE de abajo por tu contraseña (la misma que pusiste en la app).
 * 2) Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar
 *    (así la dirección /exec no cambia).
 */
const CLAVE = 'cambia-esta-clave';

const ARCHIVO = 'amigo-invisible-datos.json';

/* ======================= Entrada ======================= */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.t) return paginaCuestionario(p.t);               // enlace del cuestionario
  return responder(atender(p));
}
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
        // MailApp respeta los emojis del asunto (GmailApp los estropea)
        MailApp.sendEmail({ to: p.to, subject: p.subject, body: p.message, htmlBody: p.html, name: 'Amigo invisible' });
        return { ok: true };
      case 'cuota':   return { ok: true, restantes: MailApp.getRemainingDailyQuota() };
      default:        return { ok: true, hola: 'Conexión correcta 🎄' };
    }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function responder(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ======================= Datos en Drive ======================= */
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
/* Guarda lo que manda la app, pero sin perder respuestas del cuestionario
   que la familia haya rellenado mientras tanto. */
function guardar(datos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const actual = leer();
    if (actual && actual.sorteos && datos && datos.sorteos) {
      const porId = {};
      actual.sorteos.forEach(s => (s.personas || []).forEach(p => { porId[p.id] = p; }));
      datos.sorteos.forEach(s => (s.personas || []).forEach(p => {
        const a = porId[p.id];
        if (a && a.respondido && (!p.respondido || a.respondido > p.respondido)) {
          p.respuestas = a.respuestas; p.respondido = a.respondido; p.cuestionario = a.cuestionario;
        }
      }));
    }
    escribir(datos);
  } finally { lock.releaseLock(); }
}

/* ======================= Cuestionario ======================= */
const CUESTIONARIOS = {
  completo: {
    nombre: 'Cuestionario completo',
    secciones: [
      { t: '🎁 Lo que más te gusta', p: [
        { id: 'ilusion', q: '¿Qué te haría más ilusión recibir?', tipo: 'multi', o: ['Ropa', 'Bisutería y accesorios', 'Bolsos', 'Maquillaje', 'Cuidado de la cara y el cuerpo', 'Perfume', 'Pijamas y ropa de casa', 'Decoración y hogar', 'Libros', 'Deporte', 'Tecnología', 'Manualidades', 'Cocina y repostería', 'Comida y dulces', 'Juegos', 'Experiencias (spa, cena, entradas)'] },
      ]},
      { t: '👗 Ropa', p: [
        { id: 'talla', q: 'Talla de camisetas, jerséis y sudaderas', tipo: 'uno', o: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
        { id: 'pantalon', q: 'Talla de pantalón', tipo: 'texto', ph: '38' },
        { id: 'pie', q: 'Número de calzado', tipo: 'texto', ph: '38' },
        { id: 'estilo', q: '¿Cómo es tu estilo?', tipo: 'multi', o: ['Casual', 'Cómodo', 'Deportivo', 'Elegante', 'Clásico', 'Moderno', 'Bohemio'] },
        { id: 'colores', q: 'Colores que más te gustan', tipo: 'multi', o: ['Negro', 'Blanco', 'Beige y camel', 'Gris', 'Marrón', 'Azul marino', 'Azul claro', 'Verde', 'Rojo', 'Burdeos', 'Rosa', 'Lila', 'Tonos pastel', 'Estampados'] },
        { id: 'nocolores', q: 'Colores que no te pondrías', tipo: 'texto', ph: 'Amarillo, naranja…' },
      ]},
      { t: '💍 Accesorios', p: [
        { id: 'metal', q: '¿Eres más de dorado o de plateado?', tipo: 'uno', o: ['Dorado', 'Plateado', 'Oro rosa', 'Me gustan todos'] },
        { id: 'accesorios', q: '¿Qué accesorios sueles llevar?', tipo: 'multi', o: ['Pendientes', 'Collares', 'Pulseras', 'Anillos', 'Reloj', 'Bolsos', 'Bufandas y pañuelos', 'Gorros y guantes', 'Pinzas y coleteros', 'Gafas de sol'] },
        { id: 'orejas', q: '¿Tienes agujeros en las orejas?', tipo: 'uno', o: ['Sí', 'No'] },
        { id: 'joyas', q: '¿Cómo te gusta la bisutería?', tipo: 'uno', o: ['Discreta y fina', 'Llamativa', 'Depende del día'] },
      ]},
      { t: '💄 Belleza y cuidado', p: [
        { id: 'piel', q: 'Tipo de piel', tipo: 'uno', o: ['Seca', 'Grasa', 'Mixta', 'Normal', 'Sensible'] },
        { id: 'maquillaje', q: '¿Usas maquillaje?', tipo: 'uno', o: ['A diario', 'A veces', 'Casi nunca'] },
        { id: 'tonos', q: 'Tonos de maquillaje que prefieres', tipo: 'multi', o: ['Naturales', 'Nude', 'Rosados', 'Rojos', 'Ahumados', 'Brillos'] },
        { id: 'aromas', q: 'Aromas que te gustan (perfumes, velas, cremas)', tipo: 'multi', o: ['Florales', 'Frutales', 'Dulces y vainilla', 'Frescos y cítricos', 'Amaderados', 'Sin perfume, por favor'] },
        { id: 'marcas', q: 'Marcas o productos que te encantan', tipo: 'texto', ph: 'Rituals, Sephora, The Ordinary…' },
      ]},
      { t: '🏡 Aficiones', p: [
        { id: 'aficiones', q: '¿Qué te gusta hacer en tu tiempo libre?', tipo: 'multi', o: ['Leer', 'Series y cine', 'Música', 'Cocinar', 'Repostería', 'Deporte', 'Pádel', 'Yoga y pilates', 'Viajar', 'Manualidades', 'Plantas', 'Mascotas', 'Fotografía', 'Juegos de mesa', 'Café y té', 'Vino'] },
        { id: 'favoritos', q: 'Libros, series, autores o grupos favoritos', tipo: 'texto', ph: '' },
      ]},
      { t: '✨ Para acertar seguro', p: [
        { id: 'deseos', q: 'Cosas concretas que te encantaría recibir', tipo: 'largo', ph: 'Una por línea' },
        { id: 'tengo', q: 'Cosas que ya tienes o que no quieres', tipo: 'largo', ph: 'Para que no te lo repitan' },
        { id: 'alergias', q: 'Alergias o algo a tener en cuenta', tipo: 'texto', ph: '' },
      ]},
    ]
  },
  sencillo: {
    nombre: 'Cuestionario rápido',
    secciones: [
      { t: '🎁 Lo que más te gusta', p: [
        { id: 'ilusion', q: '¿Qué te haría más ilusión recibir?', tipo: 'multi', o: ['Ropa', 'Deporte', 'Tecnología', 'Juegos de mesa', 'Videojuegos', 'LEGO y maquetas', 'Herramientas y bricolaje', 'Café', 'Cerveza o vino', 'Comida', 'Libros y cómics', 'Colonia y cuidado personal', 'Cosas de mi equipo', 'Experiencias'] },
      ]},
      { t: '👕 Ropa', p: [
        { id: 'talla', q: 'Talla de camisetas y sudaderas', tipo: 'uno', o: ['S', 'M', 'L', 'XL', 'XXL'] },
        { id: 'pie', q: 'Número de calzado', tipo: 'texto', ph: '43' },
        { id: 'colores', q: 'Colores que te gustan', tipo: 'multi', o: ['Negro', 'Gris', 'Azul marino', 'Azul', 'Verde', 'Beige', 'Blanco', 'Burdeos'] },
      ]},
      { t: '⚽ Aficiones', p: [
        { id: 'equipo', q: 'Equipo o deporte favorito', tipo: 'texto', ph: 'Real Madrid, pádel…' },
        { id: 'aficiones', q: 'Otras aficiones', tipo: 'texto', ph: 'Carpintería, running, series…' },
      ]},
      { t: '✨ Para acertar seguro', p: [
        { id: 'deseos', q: 'Cosas concretas que te gustaría recibir', tipo: 'largo', ph: 'Una por línea' },
        { id: 'tengo', q: 'Cosas que ya tienes o que no quieres', tipo: 'largo', ph: 'Para que no te lo repitan' },
      ]},
    ]
  }
};

function buscarPorToken(datos, token) {
  if (!datos || !datos.sorteos || !token) return null;
  for (const s of datos.sorteos) for (const p of (s.personas || [])) if (p.token && p.token === token) return p;
  return null;
}

/* La llama la página del cuestionario al pulsar Guardar */
function guardarRespuestas(token, tipo, raw, lista) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const datos = leer();
    const p = buscarPorToken(datos, token);
    if (!p) throw new Error('Enlace no válido');
    const ahora = new Date().toISOString();
    const correo = String(p.email || '').trim().toLowerCase();
    // Se guarda en esa persona y en sus otras fichas con el mismo correo (por ejemplo, en otro sorteo)
    datos.sorteos.forEach(s => (s.personas || []).forEach(x => {
      if (x === p || (correo && String(x.email || '').trim().toLowerCase() === correo && x.nombre === p.nombre)) {
        x.cuestionario = tipo; x.respuestas = { raw: raw, lista: lista }; x.respondido = ahora;
      }
    }));
    datos.rev = Date.now();
    escribir(datos);
    return true;
  } finally { lock.releaseLock(); }
}

function paginaCuestionario(token) {
  const datos = leer();
  const p = buscarPorToken(datos, token);
  const info = p ? {
    token: token, nombre: p.nombre, tipo: p.cuestionario || '',
    raw: (p.respuestas && p.respuestas.raw) || {}, cuestionarios: CUESTIONARIOS
  } : null;
  const json = JSON.stringify(info).replace(/</g, '\\u003c');
  const html = PAGINA.replace('__DATOS__', json);
  return HtmlService.createHtmlOutput(html)
    .setTitle('🎁 Amigo invisible · Tus gustos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

const PAGINA = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Mountains+of+Christmas:wght@700&family=Nunito:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;background:#0f2e22;color:#fff8ec;font-family:Nunito,Arial,sans-serif;padding:16px 14px 110px}
.w{max-width:560px;margin:0 auto}
h1{font-family:'Mountains of Christmas',Georgia,serif;color:#ffd666;text-align:center;font-size:36px;margin:8px 0 2px}
.sub{text-align:center;color:#cfe3d6;margin:0 0 16px;line-height:1.45}
.card{background:#fff8ec;color:#3a1410;border-radius:18px;padding:16px;margin-bottom:14px;border-top:6px solid #c0392b}
.card h2{font-family:'Mountains of Christmas',Georgia,serif;color:#9e2a1f;margin:0 0 6px;font-size:26px}
.q{font-weight:800;margin:14px 0 8px;font-size:16px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:2px solid #e4d3b4;background:#fff;color:#3a1410;border-radius:999px;padding:9px 14px;font:700 15px Nunito,Arial;cursor:pointer}
.chip.on{background:#2e8b57;border-color:#2e8b57;color:#fff}
.chip.on:before{content:"✓ "}
input,textarea{width:100%;border:2px solid #e4d3b4;border-radius:12px;padding:11px 12px;font:16px Nunito,Arial;color:#3a1410;background:#fff}
textarea{min-height:90px;resize:vertical}
input:focus,textarea:focus{outline:none;border-color:#e9b44c}
.save{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;width:min(528px,calc(100% - 28px));border:0;border-radius:18px;padding:16px;font:700 22px 'Mountains of Christmas',Georgia,serif;background:#c0392b;color:#fff;box-shadow:0 6px 0 #9e2a1f;cursor:pointer}
.save[disabled]{opacity:.6}
.pick{display:block;width:100%;text-align:left;border:0;border-radius:16px;padding:16px;margin-bottom:12px;background:#fff8ec;color:#3a1410;cursor:pointer;font:16px Nunito,Arial}
.pick b{display:block;font-size:19px;color:#9e2a1f;margin-bottom:4px}
.done{text-align:center;padding:30px 10px}.done .big{font-size:60px}
.note{font-size:13px;color:#7a4a3a}
.cambiar{background:none;border:0;color:#ffd666;text-decoration:underline;font:14px Nunito,Arial;display:block;margin:0 auto 14px;cursor:pointer}
</style></head><body><div class="w" id="app"></div>
<script>
const D = __DATOS__;
const app = document.getElementById('app');
const esc = t => String(t==null?'':t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let tipo = D && D.tipo, raw = (D && D.raw) || {};
function inicio(){
  if(!D){ app.innerHTML='<h1>Amigo invisible</h1><div class="card">Este enlace no es válido o ya no existe. Pide uno nuevo a quien organiza el sorteo.</div>'; return; }
  if(!tipo) return elegir();
  formulario();
}
function elegir(){
  app.innerHTML='<h1>¡Hola, '+esc(D.nombre)+'!</h1><p class="sub">Cuéntale a tu amigo invisible qué te gusta para que acierte con tu regalo. Elige el cuestionario:</p>'+
    '<button class="pick" onclick="tipo=\\'completo\\';formulario()"><b>✨ Completo</b>Tallas, colores, accesorios, belleza y aficiones. Unos 4 minutos.</button>'+
    '<button class="pick" onclick="tipo=\\'sencillo\\';formulario()"><b>⚡ Rápido</b>Lo básico: qué te gusta, talla y aficiones. Unos 2 minutos.</button>';
}
function formulario(){
  const C = D.cuestionarios[tipo];
  let h='<h1>¡Hola, '+esc(D.nombre)+'!</h1><p class="sub">Responde lo que quieras: nada es obligatorio. Lo que pongas le llegará a quien te regale, y nadie sabrá quién es. 🤫</p>';
  h+='<button class="cambiar" onclick="tipo=\\'\\';elegir()">Cambiar a '+(tipo==='completo'?'cuestionario rápido':'cuestionario completo')+'</button>';
  C.secciones.forEach(s=>{
    h+='<div class="card"><h2>'+esc(s.t)+'</h2>';
    s.p.forEach(q=>{
      h+='<div class="q">'+esc(q.q)+'</div>';
      const v = raw[q.id];
      if(q.tipo==='multi'||q.tipo==='uno'){
        h+='<div class="chips" data-id="'+q.id+'" data-tipo="'+q.tipo+'">'+q.o.map(o=>{
          const on = q.tipo==='multi' ? (Array.isArray(v)&&v.indexOf(o)>=0) : v===o;
          return '<button type="button" class="chip'+(on?' on':'')+'" data-v="'+esc(o)+'">'+esc(o)+'</button>'; }).join('')+'</div>';
      } else if(q.tipo==='largo'){
        h+='<textarea data-id="'+q.id+'" placeholder="'+esc(q.ph||'')+'">'+esc(v||'')+'</textarea>';
      } else {
        h+='<input data-id="'+q.id+'" value="'+esc(v||'')+'" placeholder="'+esc(q.ph||'')+'">';
      }
    });
    h+='</div>';
  });
  h+='<p class="note" style="color:#cfe3d6;text-align:center">Puedes volver a abrir este enlace para cambiar tus respuestas cuando quieras.</p>';
  h+='<button class="save" id="save" onclick="guardar()">🎁 Guardar mis gustos</button>';
  app.innerHTML=h; window.scrollTo(0,0);
  document.querySelectorAll('.chips').forEach(g=>g.addEventListener('click',e=>{
    const b=e.target.closest('.chip'); if(!b) return;
    if(g.dataset.tipo==='uno'){ const was=b.classList.contains('on'); g.querySelectorAll('.chip').forEach(x=>x.classList.remove('on')); if(!was) b.classList.add('on'); }
    else b.classList.toggle('on');
  }));
}
function guardar(){
  const C = D.cuestionarios[tipo], r={}, lista=[];
  C.secciones.forEach(s=>s.p.forEach(q=>{
    let v;
    if(q.tipo==='multi'){ v=[...document.querySelectorAll('.chips[data-id="'+q.id+'"] .chip.on')].map(b=>b.dataset.v); if(!v.length) v=null; }
    else if(q.tipo==='uno'){ const b=document.querySelector('.chips[data-id="'+q.id+'"] .chip.on'); v=b?b.dataset.v:null; }
    else { v=(document.querySelector('[data-id="'+q.id+'"]').value||'').trim()||null; }
    if(v){ r[q.id]=v; lista.push({q:q.q, a:Array.isArray(v)?v.join(', '):v}); }
  }));
  const b=document.getElementById('save'); b.disabled=true; b.textContent='Guardando…';
  google.script.run.withSuccessHandler(()=>{
    raw=r;
    app.innerHTML='<div class="done"><div class="big">🎄</div><h1>¡Gracias, '+esc(D.nombre)+'!</h1><p class="sub">Tus gustos se han guardado. Tu amigo invisible los recibirá con el resultado del sorteo.</p><button class="pick" style="text-align:center" onclick="formulario()">✏️ Cambiar mis respuestas</button></div>';
    window.scrollTo(0,0);
  }).withFailureHandler(err=>{ b.disabled=false; b.textContent='🎁 Guardar mis gustos'; alert('No se pudo guardar. Inténtalo otra vez.'); })
    .guardarRespuestas(D.token, tipo, r, lista);
}
inicio();
</script></body></html>`;

/** Ejecuta esta función una vez desde el editor para dar permisos (Gmail y Drive). */
function darPermisos() {
  Logger.log('Correos que puedes enviar hoy: ' + MailApp.getRemainingDailyQuota());
  Logger.log('Datos guardados: ' + (archivo() ? 'sí' : 'todavía no'));
}
