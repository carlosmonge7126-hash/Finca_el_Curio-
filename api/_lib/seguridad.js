import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════════
// Utilidades de seguridad compartidas por todos los endpoints.
// Vive en "_lib" a propósito: Vercel NO convierte en función lo
// que empieza con "_", así que no cuenta para el límite de 12.
// ═══════════════════════════════════════════════════════════

const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// ── IP real del visitante (Vercel pisa x-forwarded-for con la IP real) ──
export function obtenerIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || String(req.headers['x-real-ip'] || '') || 'desconocida';
}

// ── Límite de intentos (anti fuerza bruta / spam) ───────────
// Usa la función SQL public.rl_hit (ver supabase_seguridad.sql), que
// cuenta de forma atómica. Si todavía no la creaste en Supabase, cae
// a un contador en memoria (menos fuerte porque cada instancia de
// Vercel tiene el suyo, pero igual frena ráfagas).
const memoria = new Map();

function hit_memoria(clave, ventanaSeg) {
  const ahora = Date.now();
  let f = memoria.get(clave);
  if (!f || ahora - f.inicio > ventanaSeg * 1000) {
    f = { n: 1, inicio: ahora };
    memoria.set(clave, f);
    if (memoria.size > 5000) { for (const [k, v] of memoria) if (ahora - v.inicio > 3600e3) memoria.delete(k); }
  } else {
    f.n += 1;
  }
  return { n: f.n, espera: Math.max(1, Math.ceil((f.inicio + ventanaSeg * 1000 - ahora) / 1000)) };
}

// Devuelve true si el intento está PERMITIDO, false si ya se pasó del máximo.
// Si se pasa un "res", al bloquear se anota cuántos segundos faltan para que se
// libere (el más largo de todos los límites que fallaron) para avisarle al usuario.
export async function permitir(nombre, valor, max, ventanaSeg, res) {
  const clave = `${nombre}:${crypto.createHash('sha256').update(String(valor || '')).digest('hex').slice(0, 32)}`;
  let n, espera;
  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.rpc('rl_hit', { p_clave: clave, p_ventana_seg: ventanaSeg });
      if (!error) {
        const fila = Array.isArray(data) ? data[0] : data;
        if (typeof fila === 'number') { n = fila; }                       // versión vieja de la función SQL
        else if (fila && typeof fila.r_intentos === 'number') { n = fila.r_intentos; espera = fila.r_espera; }
      }
    } catch { /* cae a memoria */ }
  }
  if (n === undefined) { const m = hit_memoria(clave, ventanaSeg); n = m.n; espera = m.espera; }
  const permitido = n <= max;
  if (!permitido && res) res._espera = Math.max(res._espera || 0, espera || ventanaSeg);
  return permitido;
}

// "5 minutos", "1 minuto", "3 horas"
export function textoEspera(seg) {
  const min = Math.max(1, Math.ceil((seg || 900) / 60));
  if (min < 120) return `${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.ceil(min / 60);
  return `${h} horas`;
}

export function responderDemasiados(res) {
  const seg = Math.max(60, res._espera || 900);
  res.setHeader('Retry-After', String(seg));
  return res.status(429).json({
    exito: false,
    error: `Demasiados intentos. Espera ${textoEspera(seg)} e inténtalo de nuevo.`,
    esperaSegundos: seg
  });
}

// ── Validación / limpieza de datos que escribe el público ───
export function limpiarTexto(valor, max = 200) {
  if (valor === undefined || valor === null) return '';
  return String(valor)
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ' ') // caracteres de control
    .replace(/[<>]/g, '')                                // sin etiquetas HTML
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function limpiarTelefono(valor) {
  return String(valor || '').replace(/[^\d+()\-\s]/g, '').trim().slice(0, 25);
}

export function esEmailValido(email) {
  return typeof email === 'string'
    && email.length <= 254
    && /^[^\s@,;<>()"'\\\[\]:]+@[^\s@,;<>()"'\\\[\]:]+\.[^\s@,;<>()"'\\\[\]:]{2,}$/.test(email);
}

export function esFechaISO(f) {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const d = new Date(f + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

export function entero(valor, min, max, porDefecto = min) {
  const n = parseInt(valor, 10);
  if (isNaN(n)) return porDefecto;
  return Math.min(max, Math.max(min, n));
}

export function esIdValido(id) {
  return (typeof id === 'string' || typeof id === 'number') && /^[A-Za-z0-9_-]{1,64}$/.test(String(id));
}

// Escapa texto para meterlo dentro de HTML (correos)
export function escaparHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Evita "inyección de fórmulas" cuando un dato termina en una hoja de cálculo
export function neutralizarFormula(s) {
  const t = String(s ?? '');
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
}

// Exige JSON en los POST (los formularios clásicos no pueden mandar esto entre sitios)
export function exigirJson(req, res) {
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    res.status(415).json({ exito: false, error: 'Content-Type no soportado.' });
    return false;
  }
  return true;
}

// Compara dos textos en tiempo constante
export function igualesSeguro(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Responde 500 sin filtrar mensajes internos (esquema de la BD, rutas, etc.)
export function errorInterno(res, error, contexto = '') {
  console.error(`❌ ${contexto}:`, error?.message || error);
  return res.status(500).json({ exito: false, error: 'Error interno del servidor.' });
}
export function errorBD(res, error, contexto = '') {
  console.error(`❌ BD ${contexto}:`, error?.message || error);
  return res.status(400).json({ exito: false, error: 'No se pudo completar la operación.' });
}

export { supabaseAdmin };
