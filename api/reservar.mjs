import { createClient } from '@supabase/supabase-js';
import {
  obtenerIp, permitir, responderDemasiados, limpiarTexto, limpiarTelefono, esEmailValido,
  esFechaISO, entero, neutralizarFormula, exigirJson, errorBD, errorInterno
} from './_lib/seguridad.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// ═══════════════════════════════════════════
// Notificaciones "de respaldo" a Google Sheets y Make.com. Antes esto
// vivía en el navegador (index.html), con las URL de los webhooks
// visibles para cualquiera que viera el código fuente. Ahora vive acá,
// del lado del servidor: las URL están en variables de entorno
// (GOOGLE_SHEETS_WEBHOOK_URL / MAKE_WEBHOOK_URL) que nunca se mandan
// al navegador. No bloquean la reserva si fallan.
// 🗑️ Para quitar una integración, borrá su función y su línea de
// llamado más abajo (o simplemente no configures esa variable de
// entorno: si no está seteada, esa notificación se salta sola).
// ═══════════════════════════════════════════
async function notificarGoogleSheets(datos) {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!url) return;
  try {
    // Los textos que empiezan con = + - @ se neutralizan: en Google Sheets
    // se ejecutarían como fórmulas ("inyección de fórmulas").
    const seguros = Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, typeof v === 'string' ? neutralizarFormula(v) : v]));
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(seguros),
      signal: AbortSignal.timeout(6000)
    });
  } catch (err) {
    console.warn('⚠️ No se pudo notificar a Google Sheets:', err.message);
  }
}

async function notificarMake(datos) {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
      signal: AbortSignal.timeout(6000)
    });
  } catch (err) {
    console.warn('⚠️ No se pudo notificar a Make.com:', err.message);
  }
}

// Fecha de hoy en Costa Rica (YYYY-MM-DD)
function hoyCR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' });
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }
  if (!exigirJson(req, res)) return;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  // Todo lo que escribe el visitante se limpia y se acota ANTES de guardarlo.
  const nombre = limpiarTexto(body.nombre, 100);
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const telefono = limpiarTelefono(body.telefono);
  const fecha = body.fecha;
  const tour = limpiarTexto(body.tour, 120);
  const horario = limpiarTexto(body.horario, 40);
  const cantidadPersonas = entero(body.cantidadPersonas, 1, 500, 1);

  if (!nombre || !email || !fecha || !tour) {
    return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios.' });
  }
  if (!esEmailValido(email)) {
    return res.status(400).json({ exito: false, error: 'El correo no es válido.' });
  }
  if (!esFechaISO(fecha) || fecha < hoyCR() || fecha > `${new Date().getFullYear() + 2}-12-31`) {
    return res.status(400).json({ exito: false, error: 'La fecha no es válida.' });
  }

  // Anti-spam: 6 reservas por hora por IP y 5 por día por correo.
  const ip = obtenerIp(req);
  if (!(await permitir('reservar-ip', ip, 6, 3600, res)) || !(await permitir('reservar-email', email.toLowerCase(), 5, 86400, res))) {
    return responderDemasiados(res);
  }

  try {
    // Cupo real validado en el servidor (antes solo lo validaba el navegador,
    // así que llamando directo a la API se podía sobre-reservar un horario).
    if (horario) {
      let capacidad = 15;
      try {
        const { data: cfg } = await supabase.from('configuracion_sitio').select('valor').eq('clave', 'cfg_general').maybeSingle();
        const c = parseInt(JSON.parse(cfg?.valor || '{}')?.capacidadHorario);
        if (c > 0) capacidad = c;
      } catch { /* si no se puede leer la config, se usa el valor por defecto */ }
      const { data: existentes } = await supabase.from('reservas').select('cantidad_personas').eq('fecha', fecha).eq('horario', horario);
      const ocupados = (existentes || []).reduce((t, r) => t + (parseInt(r.cantidad_personas) || 1), 0);
      if (ocupados + cantidadPersonas > capacidad) {
        return res.status(409).json({ exito: false, error: 'Ese horario ya no tiene cupo disponible.' });
      }
    }

    const { data, error } = await supabase
      .from('reservas')
      .insert([{ nombre, email, telefono, fecha, tour, horario, cantidad_personas: cantidadPersonas }])
      .select('id');

    if (error) return errorBD(res, error, 'reservar.insert');

    // Notificaciones de respaldo, en paralelo, sin bloquear la respuesta
    // ni hacer fallar la reserva si alguna de las dos no responde.
    const datosNotif = { nombre, email, telefono, fecha, tour, horario, cantidadPersonas };
    await Promise.all([
      notificarGoogleSheets(datosNotif),
      notificarMake(datosNotif)
    ]);

    // Solo se devuelve el id (antes se devolvía la fila completa)
    return res.status(200).json({ exito: true, mensaje: '¡Reserva confirmada con éxito!', reserva: (data || []).map(r => ({ id: r.id })) });
  } catch (error) {
    return errorInterno(res, error, 'reservar');
  }
}
