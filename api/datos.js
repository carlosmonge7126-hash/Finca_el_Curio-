import { createClient } from '@supabase/supabase-js';
import { exigirAdmin } from './_lib/adminAuth.js';
import { verificarPassword } from './_lib/passwords.js';
import {
  obtenerIp, permitir, responderDemasiados, limpiarTexto, limpiarTelefono, esEmailValido,
  esFechaISO, esIdValido, exigirJson, errorBD, errorInterno
} from './_lib/seguridad.js';

// ═══════════════════════════════════════════════════════════
// ENDPOINT ÚNICO DE DATOS (cuenta como 1 sola función en Vercel).
//
// Antes el navegador leía y escribía directo en Supabase con la clave
// pública ("anon"), que está a la vista de cualquiera que abra el código
// fuente. Eso obligaba a dejar las tablas abiertas: cualquiera podía
// bajarse nombres/correos/teléfonos de clientes, borrar el historial,
// cambiar las cuentas bancarias que muestra el sitio o subir archivos.
//
// Ahora el navegador NO toca esas tablas: todo pasa por aquí, con la
// SERVICE_ROLE_KEY (que solo existe en Vercel) y con estas reglas:
//   • GET  público  → solo datos SIN información personal.
//   • POST admin    → exige el header x-admin-token (sesión de admin).
//   • POST público  → testimonio, y solo demostrando ser cliente.
// ═══════════════════════════════════════════════════════════

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = 'imagenes';

const EXT_PERMITIDAS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'mp4', 'webm', 'mov', 'mp3', 'm4a', 'ogg', 'wav']);

function hoyCR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' });
}
function ayerCR() {
  const d = new Date(hoyCR() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const claveValida = (c) => typeof c === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(c);

function rutaValida(ruta) {
  if (typeof ruta !== 'string' || ruta.length > 220 || ruta.startsWith('/') || ruta.includes('..') || ruta.includes('//')) return false;
  if (!/^[A-Za-z0-9_\-./@+]+$/.test(ruta)) return false;
  const ext = ruta.split('.').pop().toLowerCase();
  return EXT_PERMITIDAS.has(ext);
}

// ─────────────────────────── GET (público, sin datos personales)
async function manejarGet(req, res) {
  if (!(await permitir('datos-get-ip', obtenerIp(req), 240, 900))) return responderDemasiados(res);
  const recurso = req.query?.recurso;

  // Disponibilidad: solo fecha/horario/cantidad. Nada de nombres, correos ni teléfonos.
  if (recurso === 'disponibilidad') {
    const { data, error } = await supabase.from('reservas')
      .select('id, fecha, horario, cantidad_personas')
      .gte('fecha', ayerCR())
      .order('fecha', { ascending: true }).limit(5000);
    if (error) return errorBD(res, error, 'datos.disponibilidad');
    return res.status(200).json({
      exito: true,
      reservas: (data || []).map(r => ({ id: r.id, fecha: r.fecha, horario: r.horario || '', cantidadPersonas: r.cantidad_personas || 1 }))
    });
  }

  // Plantas: solo el código y si está ocupada (para el contador de cupos). Sin dueño.
  if (recurso === 'plantas') {
    const { data, error } = await supabase.from('plantas').select('codigo, cliente_email');
    if (error) return errorBD(res, error, 'datos.plantas');
    return res.status(200).json({ exito: true, plantas: (data || []).map(p => ({ codigo: p.codigo, ocupada: !!p.cliente_email })) });
  }

  return res.status(400).json({ exito: false, error: 'Recurso no válido.' });
}

// ─────────────────────────── POST público: testimonio de un cliente
async function testimonioPublico(req, res, body) {
  if (!(await permitir('testimonio-ip', obtenerIp(req), 5, 3600))) return responderDemasiados(res);
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const texto = limpiarTexto(body.texto, 1500);
  if (!esEmailValido(email) || typeof body.password !== 'string' || !texto) {
    return res.status(400).json({ exito: false, error: 'Faltan campos.' });
  }
  if (!(await permitir('testimonio-email', email.toLowerCase(), 5, 86400))) return responderDemasiados(res);

  // Solo un cliente real (con su contraseña) puede publicar
  const { data: cli, error: errCli } = await supabase.from('clientes').select('nombre, password, eliminado').eq('email', email).maybeSingle();
  if (errCli) return errorBD(res, errCli, 'datos.testimonio.cliente');
  if (!cli || cli.eliminado || !(await verificarPassword(body.password, cli.password))) {
    return res.status(401).json({ exito: false, error: 'No autorizado.' });
  }
  const anon = !!body.anon;
  const autor = anon
    ? (body.lang === 'en' ? 'Anonymous visitor' : 'Visitante anónimo')
    : limpiarTexto(String(cli.nombre || '').split(' ')[0], 40) || 'Visitante';
  const { data, error } = await supabase.from('testimonios').insert([{ texto, autor, anon }]).select('id, texto, autor, anon, fecha');
  if (error) return errorBD(res, error, 'datos.testimonio.insert');
  return res.status(200).json({ exito: true, testimonio: data?.[0] || null });
}

// ─────────────────────────── POST admin
async function manejarAdmin(req, res, body) {
  if (!exigirAdmin(req, res)) return;
  const { accion } = body;

  switch (accion) {
    case 'reservas_listar': {
      const { data, error } = await supabase.from('reservas').select('*').order('fecha', { ascending: true }).limit(10000);
      if (error) return errorBD(res, error, 'datos.reservas_listar');
      return res.status(200).json({ exito: true, reservas: data || [] });
    }
    case 'padrinos_listar': {
      const { data, error } = await supabase.from('padrinos').select('*').order('created_at', { ascending: false }).limit(10000);
      if (error) return errorBD(res, error, 'datos.padrinos_listar');
      return res.status(200).json({ exito: true, padrinos: data || [] });
    }
    case 'cancelaciones_listar': {
      const { data, error } = await supabase.from('cancelaciones').select('*').order('fecha_evento', { ascending: false }).limit(10000);
      if (error) return errorBD(res, error, 'datos.cancelaciones_listar');
      return res.status(200).json({ exito: true, cancelaciones: data || [] });
    }
    case 'cancelacion_crear': {
      const c = (body.c && typeof body.c === 'object') ? body.c : {};
      const fila = {
        nombre: limpiarTexto(c.nombre, 100), email: limpiarTexto(c.email, 254), telefono: limpiarTelefono(c.telefono),
        fecha: limpiarTexto(c.fecha, 20), horario: limpiarTexto(c.horario, 40), tour: limpiarTexto(c.tour, 120),
        estado: ['cancelada', 'completada'].includes(c.estado) ? c.estado : 'cancelada'
      };
      const { error } = await supabase.from('cancelaciones').insert([fila]);
      if (error) return errorBD(res, error, 'datos.cancelacion_crear');
      return res.status(200).json({ exito: true });
    }
    case 'cancelaciones_limpiar': {
      const { error } = await supabase.from('cancelaciones').delete().not('id', 'is', null);
      if (error) return errorBD(res, error, 'datos.cancelaciones_limpiar');
      return res.status(200).json({ exito: true });
    }
    case 'plantas_listar': {
      const { data, error } = await supabase.from('plantas').select('*');
      if (error) return errorBD(res, error, 'datos.plantas_listar');
      return res.status(200).json({ exito: true, plantas: data || [] });
    }
    case 'planta_guardar': {
      const p = (body.p && typeof body.p === 'object') ? body.p : {};
      const codigo = limpiarTexto(p.codigo, 20);
      if (!codigo) return res.status(400).json({ exito: false, error: 'Falta el código de la planta.' });
      const historial = Array.isArray(p.historialComentarios) ? p.historialComentarios.slice(0, 500) : [];
      const { error } = await supabase.from('plantas').upsert({
        codigo,
        imagen: p.imagen ? limpiarTexto(p.imagen, 1000) : null,
        comentario: limpiarTexto(p.comentario, 2000),
        cliente_email: p.clienteEmail ? limpiarTexto(p.clienteEmail, 254) : null,
        fecha_asignacion: p.fechaAsignacion ? limpiarTexto(p.fechaAsignacion, 40) : null,
        historial_comentarios: historial,
        actualizado_en: new Date().toISOString()
      }, { onConflict: 'codigo' });
      if (error) return errorBD(res, error, 'datos.planta_guardar');
      return res.status(200).json({ exito: true });
    }
    case 'testimonio_eliminar': {
      if (!esIdValido(body.id)) return res.status(400).json({ exito: false, error: 'Identificador no válido.' });
      const { error } = await supabase.from('testimonios').delete().eq('id', body.id);
      if (error) return errorBD(res, error, 'datos.testimonio_eliminar');
      return res.status(200).json({ exito: true });
    }
    case 'config_guardar': {
      if (!claveValida(body.clave) || typeof body.valor !== 'string' || body.valor.length > 1_500_000) {
        return res.status(400).json({ exito: false, error: 'Datos de configuración no válidos.' });
      }
      const { error } = await supabase.from('configuracion_sitio')
        .upsert({ clave: body.clave, valor: body.valor, actualizado_en: new Date().toISOString() }, { onConflict: 'clave' });
      if (error) return errorBD(res, error, 'datos.config_guardar');
      return res.status(200).json({ exito: true });
    }
    case 'config_eliminar': {
      if (!claveValida(body.clave)) return res.status(400).json({ exito: false, error: 'Clave no válida.' });
      const { error } = await supabase.from('configuracion_sitio').delete().eq('clave', body.clave);
      if (error) return errorBD(res, error, 'datos.config_eliminar');
      return res.status(200).json({ exito: true });
    }
    // Subida de archivos: el servidor entrega un permiso de UN solo archivo y de UNA
    // ruta concreta (con extensión permitida). El navegador ya no puede subir "lo que sea".
    case 'storage_firmar': {
      if (!rutaValida(body.ruta)) return res.status(400).json({ exito: false, error: 'Ruta o tipo de archivo no permitido.' });
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(body.ruta, { upsert: true });
      if (error || !data) return errorBD(res, error, 'datos.storage_firmar');
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(body.ruta);
      return res.status(200).json({ exito: true, ruta: data.path || body.ruta, token: data.token, urlPublica: pub?.publicUrl || null });
    }
    case 'storage_eliminar': {
      if (!rutaValida(body.ruta)) return res.status(400).json({ exito: false, error: 'Ruta no válida.' });
      const { error } = await supabase.storage.from(BUCKET).remove([body.ruta]);
      if (error) return errorBD(res, error, 'datos.storage_eliminar');
      return res.status(200).json({ exito: true });
    }
    default:
      return res.status(400).json({ exito: false, error: 'Acción no reconocida.' });
  }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return await manejarGet(req, res);
    if (req.method !== 'POST') return res.status(405).json({ exito: false, error: 'Método no permitido' });
    if (!exigirJson(req, res)) return;
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    if (body.accion === 'testimonio') return await testimonioPublico(req, res, body);
    return await manejarAdmin(req, res, body);
  } catch (error) {
    return errorInterno(res, error, 'datos');
  }
}
