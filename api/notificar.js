import { createClient } from '@supabase/supabase-js';
import { exigirAdmin, esPeticionAdmin } from './_lib/adminAuth.js';
import {
  obtenerIp, permitir, responderDemasiados, limpiarTexto, esEmailValido, esFechaISO,
  entero, esIdValido, escaparHtml, igualesSeguro, exigirJson, errorBD
} from './_lib/seguridad.js';
import {
  transporter, credencialesCorreoListas, formatearFecha, linkWhatsApp,
  obtenerBaseUrl, encabezadoCorreo, tarjetaCorreo, filaDato, plantillaRecordatorio,
  adjuntoLogo
} from './_lib/correo.js';

// ═══════════════════════════════════════════════════════════
// Endpoint UNIFICADO de notificaciones por correo.
// ═══════════════════════════════════════════════════════════

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// ───────────────────────────────────────────────────────────
// SEGURIDAD: este endpoint manda correos DESDE LA CUENTA DE LA FINCA.
//  • "reserva" lo puede llamar el visitante (justo al reservar), pero el
//    servidor NO confía en lo que mande: busca la reserva en la base de
//    datos y escribe SOLO al correo guardado ahí, una sola vez.
//  • El resto de tipos (reasignación, cancelación, recordatorio manual)
//    exigen sesión de admin.
//  • El cron exige CRON_SECRET siempre.
//  • Todo texto que va dentro del HTML del correo se escapa.
// ───────────────────────────────────────────────────────────
const LANGS = ['es', 'en'];
const normLang = (l) => (LANGS.includes(l) ? l : 'es');
const soloDigitos = (t) => String(t || '').replace(/\D/g, '').slice(0, 15);

// Valida y limpia los datos de un correo a cliente. Devuelve null si algo no cuadra.
function validarDatosCorreo(b, { exigirHorario = true } = {}) {
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  const nombre = limpiarTexto(b.nombre, 100);
  const fecha = b.fecha;
  const horario = limpiarTexto(b.horario, 40);
  if (!esEmailValido(email) || !nombre || !esFechaISO(fecha)) return null;
  if (exigirHorario && !horario) return null;
  return {
    email, nombre, fecha, horario,
    tour: limpiarTexto(b.tour, 120),
    personas: entero(b.personas, 1, 500, 1),
    lang: normLang(b.lang),
    telefonoFinca: soloDigitos(b.telefonoFinca),
    motivo: limpiarTexto(b.motivo, 300)
  };
}

// ───────────────────────────────────────────────────────────
// tipo=reserva  (confirmación de reserva con fecha/hora asignada)
// ───────────────────────────────────────────────────────────
function plantillaReserva({ nombre, fecha, horario, tour, personas, lang, telefonoFinca, baseUrl }) {
  const fechaBonita = formatearFecha(fecha, lang);
  const es = lang !== 'en';
  
  // CORRECCIÓN: Texto plano sin tags <span style="color:..."> alrededor
  const titulo = es ? '¡Reserva confirmada!' : 'Reservation confirmed!';
  
  const saludo = es ? `Hola ${escaparHtml(nombre)},` : `Hi ${escaparHtml(nombre)},`;
  const cuerpo = es
    ? `Tu visita a <strong>Finca El Curio</strong> ya tiene fecha y hora asignada. ¡Te esperamos!`
    : `Your visit to <strong>Finca El Curio</strong> now has a confirmed date and time. We can't wait to see you!`;
  const lblFecha = es ? 'Fecha' : 'Date';
  const lblHora = es ? 'Hora' : 'Time';
  const lblTour = es ? 'Actividad' : 'Activity';
  const lblPersonas = es ? 'Personas' : 'People';
  const waLink = linkWhatsApp(telefonoFinca);
  const waTexto = es ? 'escribinos por WhatsApp' : 'message us on WhatsApp';
  const waEnlace = waLink ? `<a href="${waLink}" style="color:#1f5b32;font-weight:bold;text-decoration:underline;">${waTexto}</a>` : waTexto;
  const despedida = es
    ? `Si tenés alguna pregunta, ${waEnlace} o responde este correo.`
    : `If you have any questions, ${waEnlace} or reply to this email.`;
  const firma = es ? 'Con cariño, el equipo de Finca El Curio 🌱' : 'With care, the Finca El Curio team 🌱';

  const encabezado = encabezadoCorreo({ baseUrl, titulo, tono: 'suave' });
  const filas = `<table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
      ${filaDato('📅', lblFecha, fechaBonita, 'arriba')}
      ${filaDato('🕐', lblHora, horario, '')}
      ${tour ? filaDato('🌾', lblTour, tour, '') : ''}
      ${filaDato('👥', lblPersonas, personas || 1, 'abajo')}
    </table>`;
  const cuerpoHtml = `
    <p style="font-size:16px;margin:0 0 12px;">${saludo}</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 22px;">${cuerpo}</p>
    ${filas}
    <p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;">${despedida}</p>
    <p style="font-size:14px;color:#1f5b32;font-weight:bold;margin:0;">${firma}</p>`;

  return tarjetaCorreo(encabezado, cuerpoHtml);
}


async function enviar(req, res, { to, asunto, html, contexto }) {
  try {
    await transporter.sendMail({
      from: `"Finca El Curio" <${process.env.GMAIL_USER}>`,
      to, subject: asunto, html,
      attachments: [adjuntoLogo()]
    });
    return true;
  } catch (error) {
    console.error(`Error enviando correo (${contexto}):`, error?.message);
    return false;
  }
}

async function manejarReserva(req, res) {
  const body = req.body || {};
  const admin = esPeticionAdmin(req);
  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'El envío de correos no está configurado.' });
  }

  let datos;
  let reservaDB = null;

  if (admin) {
    // El admin acaba de asignar horario desde el panel: se usan sus datos
    // (la base de datos puede no haberse actualizado todavía).
    datos = validarDatosCorreo(body);
    if (!datos) return res.status(400).json({ exito: false, error: 'Faltan o no son válidos los campos (email, nombre, fecha, horario).' });
  } else {
    // Visitante: solo puede pedir el correo de SU reserva recién creada.
    if (!(await permitir('notif-reserva-ip', obtenerIp(req), 10, 3600))) return responderDemasiados(res);
    if (!esIdValido(body.id) || !supabase) {
      return res.status(400).json({ exito: false, error: 'Falta el id de la reserva.' });
    }
    const { data: r, error } = await supabase
      .from('reservas')
      .select('id, nombre, email, fecha, horario, tour, cantidad_personas, correo_confirmacion_enviado, created_at')
      .eq('id', body.id).maybeSingle();
    if (error) return errorBD(res, error, 'notificar.reserva');
    if (!r || !r.horario || !r.email) return res.status(404).json({ exito: false, error: 'Reserva no encontrada.' });
    if (r.correo_confirmacion_enviado) return res.status(409).json({ exito: false, error: 'El correo ya fue enviado.' });
    // Solo vale durante los primeros 30 minutos de creada la reserva
    if (!r.created_at || Date.now() - new Date(r.created_at).getTime() > 30 * 60 * 1000) {
      return res.status(403).json({ exito: false, error: 'No autorizado.' });
    }
    reservaDB = r;
    datos = {
      email: r.email, nombre: limpiarTexto(r.nombre, 100), fecha: r.fecha,
      horario: limpiarTexto(r.horario, 40), tour: limpiarTexto(r.tour, 120),
      personas: entero(r.cantidad_personas, 1, 500, 1),
      lang: normLang(body.lang), telefonoFinca: soloDigitos(body.telefonoFinca)
    };
    if (!esEmailValido(datos.email) || !esFechaISO(datos.fecha)) {
      return res.status(400).json({ exito: false, error: 'Datos de la reserva no válidos.' });
    }
  }

  const esEs = datos.lang !== 'en';
  const asunto = esEs
    ? `✅ Confirmación de tu reserva en Finca El Curio — ${datos.fecha}`
    : `✅ Your Finca El Curio reservation is confirmed — ${datos.fecha}`;
  const baseUrl = obtenerBaseUrl(req);

  const ok = await enviar(req, res, {
    to: datos.email, asunto, contexto: 'confirmación',
    html: plantillaReserva({ ...datos, baseUrl })
  });
  if (!ok) return res.status(500).json({ exito: false, error: 'No se pudo enviar el correo.' });

  // Se marca como enviado en el servidor (el navegador ya no puede hacerlo)
  if (reservaDB && supabase) {
    const { error } = await supabase.from('reservas').update({ correo_confirmacion_enviado: true }).eq('id', reservaDB.id);
    if (error) console.warn('⚠️ No se pudo marcar correo_confirmacion_enviado:', error.message);
  }
  return res.status(200).json({ exito: true });
}

// ───────────────────────────────────────────────────────────
// tipo=reserva-reasignada  (cambio de fecha/hora de una reserva ya confirmada)
// ───────────────────────────────────────────────────────────
function plantillaReservaReasignada({ nombre, fecha, horario, tour, personas, lang, telefonoFinca, baseUrl }) {
  const fechaBonita = formatearFecha(fecha, lang);
  const es = lang !== 'en';
  const titulo = es ? 'Tu reserva ha sido reasignada' : 'Your booking has been rescheduled';
  const saludo = es ? `Hola ${escaparHtml(nombre)},` : `Hi ${escaparHtml(nombre)},`;
  const cuerpo = es
    ? `La fecha y/u hora de tu visita a <strong>Finca El Curio</strong> cambiaron. Estos son los nuevos datos de tu reserva:`
    : `The date and/or time of your visit to <strong>Finca El Curio</strong> changed. Here are your new booking details:`;
  const lblFecha = es ? 'Nueva fecha' : 'New date';
  const lblHora = es ? 'Nuevo horario' : 'New time';
  const lblTour = es ? 'Actividad' : 'Activity';
  const lblPersonas = es ? 'Personas' : 'People';
  const waLink = linkWhatsApp(telefonoFinca);
  const waTexto = es ? 'escribinos por WhatsApp' : 'message us on WhatsApp';
  const waEnlace = waLink ? `<a href="${waLink}" style="color:#1f5b32;font-weight:bold;text-decoration:underline;">${waTexto}</a>` : waTexto;
  const despedida = es
    ? `Si este cambio no te funciona o tenés alguna pregunta, ${waEnlace} o responde este correo.`
    : `If this new time doesn't work for you or you have any questions, ${waEnlace} or reply to this email.`;
  const firma = es ? 'Con cariño, el equipo de Finca El Curio 🌱' : 'With care, the Finca El Curio team 🌱';

  const encabezado = encabezadoCorreo({ baseUrl, titulo, tono: 'normal' });
  const filas = `<table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
      ${filaDato('📅', lblFecha, fechaBonita, 'arriba')}
      ${filaDato('🕐', lblHora, horario, '')}
      ${tour ? filaDato('🌾', lblTour, tour, '') : ''}
      ${filaDato('👥', lblPersonas, personas || 1, 'abajo')}
    </table>`;
  const cuerpoHtml = `
    <p style="font-size:16px;margin:0 0 12px;">${saludo}</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 22px;">${cuerpo}</p>
    ${filas}
    <p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;">${despedida}</p>
    <p style="font-size:14px;color:#1f5b32;font-weight:bold;margin:0;">${firma}</p>`;

  return tarjetaCorreo(encabezado, cuerpoHtml);
}

async function manejarReservaReasignada(req, res) {
  if (!exigirAdmin(req, res)) return;
  const datos = validarDatosCorreo(req.body || {});
  if (!datos) return res.status(400).json({ exito: false, error: 'Faltan o no son válidos los campos (email, nombre, fecha, horario).' });
  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'El envío de correos no está configurado.' });
  }
  const esEs = datos.lang !== 'en';
  const asunto = esEs
    ? `🔄 Tu reserva en Finca El Curio fue reasignada — ${datos.fecha}`
    : `🔄 Your Finca El Curio reservation was rescheduled — ${datos.fecha}`;
  const ok = await enviar(req, res, {
    to: datos.email, asunto, contexto: 'reasignación',
    html: plantillaReservaReasignada({ ...datos, baseUrl: obtenerBaseUrl(req) })
  });
  if (!ok) return res.status(500).json({ exito: false, error: 'No se pudo enviar el correo.' });
  return res.status(200).json({ exito: true });
}

// ───────────────────────────────────────────────────────────
// tipo=cancelacion  (aviso de cancelación de una reserva)
// ───────────────────────────────────────────────────────────
function plantillaCancelacion({ nombre, fecha, horario, tour, lang, telefonoFinca, motivo, baseUrl }) {
  const fechaBonita = formatearFecha(fecha, lang);
  const es = lang !== 'en';
  const titulo = es ? 'Tu reserva fue cancelada' : 'Your reservation was cancelled';
  const saludo = es ? `Hola ${escaparHtml(nombre)},` : `Hi ${escaparHtml(nombre)},`;
  const cuerpo = es
    ? `Te escribimos para informarte que tu visita a <strong>Finca El Curio</strong> que tenías agendada fue <strong>cancelada</strong> por nuestro equipo.`
    : `We are writing to inform you that your scheduled visit to <strong>Finca El Curio</strong> has been <strong>canceled</strong> by our team.`;
  const motivoHtml = motivo
    ? `<p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;"><strong>${es ? 'Motivo' : 'Reason'}:</strong> ${escaparHtml(motivo)}</p>`
    : '';
  const lblFecha = es ? 'Fecha que tenías reservada' : 'Date you had booked';
  const lblHora = es ? 'Hora' : 'Time';
  const lblTour = es ? 'Actividad' : 'Activity';
  const waLink = linkWhatsApp(telefonoFinca);
  const waTexto = es ? 'escríbenos por WhatsApp' : 'message us on WhatsApp';
  const waEnlace = waLink ? `<a href="${waLink}" style="color:#1f5b32;font-weight:bold;text-decoration:underline;">${waTexto}</a>` : waTexto;
  const despedida = es
    ? `Reagenda tu visita ingresando a ${baseUrl}/#reservas, respondiendo este correo o ${waEnlace}. ¡Con gusto te ayudaremos a encontrar una nueva fecha!`
    : `Reschedule your visit by going to ${baseUrl}/#reservas, replying to this email, or ${waEnlace}. We will gladly help you find a new date!`;
  const firma = es ? 'Con cariño, el equipo de Finca El Curio 🌱' : 'With care, the Finca El Curio team 🌱';

  const encabezado = encabezadoCorreo({ baseUrl, titulo, tono: 'normal' });
  const filas = `<table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
      ${filaDato('📅', lblFecha, fechaBonita, 'arriba')}
      ${horario ? filaDato('🕐', lblHora, horario, '') : ''}
      ${tour ? filaDato('🌾', lblTour, tour, 'abajo') : ''}
    </table>`;
  const cuerpoHtml = `
    <p style="font-size:16px;margin:0 0 12px;">${saludo}</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">${cuerpo}</p>
    ${motivoHtml}
    ${filas}
    <p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;">${despedida}</p>
    <p style="font-size:14px;color:#1f5b32;font-weight:bold;margin:0;">${firma}</p>`;

  return tarjetaCorreo(encabezado, cuerpoHtml);
}

async function manejarCancelacion(req, res) {
  if (!exigirAdmin(req, res)) return;
  const datos = validarDatosCorreo(req.body || {}, { exigirHorario: false });
  if (!datos) return res.status(400).json({ exito: false, error: 'Faltan o no son válidos los campos (email, nombre, fecha).' });
  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'El envío de correos no está configurado.' });
  }
  const esEs = datos.lang !== 'en';
  const asunto = esEs
    ? `❌ Tu reserva en Finca El Curio fue cancelada — ${datos.fecha}`
    : `❌ Your Finca El Curio reservation was cancelled — ${datos.fecha}`;
  const ok = await enviar(req, res, {
    to: datos.email, asunto, contexto: 'cancelación',
    html: plantillaCancelacion({ ...datos, baseUrl: obtenerBaseUrl(req) })
  });
  if (!ok) return res.status(500).json({ exito: false, error: 'No se pudo enviar el correo.' });
  return res.status(200).json({ exito: true });
}

// ───────────────────────────────────────────────────────────
// tipo=recordatorio-manual  (botón "📧 Recordatorio" del panel admin)
// ───────────────────────────────────────────────────────────
async function manejarRecordatorioManual(req, res) {
  if (!exigirAdmin(req, res)) return;
  const datos = validarDatosCorreo(req.body || {});
  const id = req.body?.id;
  if (!datos) return res.status(400).json({ exito: false, error: 'Faltan o no son válidos los campos (email, nombre, fecha, horario).' });
  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'El envío de correos no está configurado.' });
  }
  const ok = await enviar(req, res, {
    to: datos.email, contexto: 'recordatorio manual',
    asunto: `🌿 ¡Te esperamos pronto en Finca El Curio! — ${datos.fecha}`,
    html: plantillaRecordatorio({ ...datos, baseUrl: obtenerBaseUrl(req) })
  });
  if (!ok) return res.status(500).json({ exito: false, error: 'No se pudo enviar el correo.' });

  if (esIdValido(id) && supabase) {
    supabase.from('reservas').update({ recordatorio_enviado: true }).eq('id', id)
      .then(({ error }) => {
        if (error) console.warn('⚠️ No se pudo marcar recordatorio_enviado:', error.message);
      });
  }
  return res.status(200).json({ exito: true });
}

// ───────────────────────────────────────────────────────────
// tipo=recordatorio  (cron automático, 1 día antes de la visita)
// ───────────────────────────────────────────────────────────
function fechaManana() {
  const hoyCR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  hoyCR.setDate(hoyCR.getDate() + 1);
  const y = hoyCR.getFullYear();
  const m = String(hoyCR.getMonth() + 1).padStart(2, '0');
  const d = String(hoyCR.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function manejarRecordatorioAutomatico(req, res) {
  // CRON_SECRET es OBLIGATORIO: antes, si no estaba definido, cualquiera
  // podía disparar el envío masivo de recordatorios. Vercel lo manda solo
  // (header Authorization: Bearer ...) cuando la variable existe en el proyecto.
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error('❌ Falta CRON_SECRET en Vercel: el cron de recordatorios está desactivado por seguridad.');
    return res.status(503).json({ exito: false, error: 'Cron no configurado.' });
  }
  if (!igualesSeguro(req.headers.authorization || '', `Bearer ${secreto}`)) {
    return res.status(401).json({ exito: false, error: 'No autorizado' });
  }

  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'El envío de correos no está configurado.' });
  }
  if (!supabase) {
    return res.status(500).json({ exito: false, error: 'La base de datos no está configurada.' });
  }

  const fecha = fechaManana();
  const baseUrl = obtenerBaseUrl(req);

  let telefonoFinca = null;
  try {
    const { data: cfgFila } = await supabase
      .from('configuracion_sitio')
      .select('valor')
      .eq('clave', 'cfg_general')
      .maybeSingle();
    if (cfgFila?.valor) telefonoFinca = soloDigitos(JSON.parse(cfgFila.valor)?.telefono) || null;
  } catch { /* no bloquea el envío de recordatorios */ }

  try {
    const { data: reservas, error } = await supabase
      .from('reservas')
      .select('id, nombre, email, telefono, fecha, horario, tour, recordatorio_enviado')
      .eq('fecha', fecha)
      .not('horario', 'is', null)
      .neq('horario', '')
      .or('recordatorio_enviado.is.false,recordatorio_enviado.is.null');

    if (error) {
      return errorBD(res, error, 'notificar.recordatorio.consulta');
    }

    const resultados = [];
    for (const r of reservas || []) {
      try {
        if (!esEmailValido(r.email) || !esFechaISO(r.fecha)) throw new Error('datos de reserva no válidos');
        await transporter.sendMail({
          from: `"Finca El Curio" <${process.env.GMAIL_USER}>`,
          to: r.email,
          subject: `🌿 ¡Te esperamos mañana en Finca El Curio! — ${r.fecha}`,
          html: plantillaRecordatorio({ nombre: limpiarTexto(r.nombre, 100), fecha: r.fecha, horario: limpiarTexto(r.horario, 40), tour: limpiarTexto(r.tour, 120), telefonoFinca, baseUrl }),
          attachments: [adjuntoLogo()]
        });
        await supabase.from('reservas').update({ recordatorio_enviado: true }).eq('id', r.id);
        resultados.push({ id: r.id, exito: true });
      } catch (err) {
        console.error(`Error enviando recordatorio a ${r.email}:`, err);
        resultados.push({ id: r.id, exito: false });
      }
    }

    return res.status(200).json({ exito: true, fecha, enviados: resultados.filter(r => r.exito).length, total: resultados.length, detalle: resultados });
  } catch (error) {
    console.error('Error general en recordatorios:', error?.message);
    return res.status(500).json({ exito: false, error: 'Error interno del servidor.' });
  }
}

// ───────────────────────────────────────────────────────────
// Router principal: decide qué correo mandar según ?tipo=
// ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (!exigirJson(req, res) && req.method === 'POST') return;

  const tipo = req.query?.tipo || (req.body && req.body.tipo);

  switch (tipo) {
    case 'reserva':
      if (req.method !== 'POST') return res.status(405).json({ exito: false, error: 'Método no permitido' });
      return manejarReserva(req, res);
    case 'reserva-reasignada':
      if (req.method !== 'POST') return res.status(405).json({ exito: false, error: 'Método no permitido' });
      return manejarReservaReasignada(req, res);
    case 'cancelacion':
      if (req.method !== 'POST') return res.status(405).json({ exito: false, error: 'Método no permitido' });
      return manejarCancelacion(req, res);
    case 'recordatorio-manual':
      if (req.method !== 'POST') return res.status(405).json({ exito: false, error: 'Método no permitido' });
      return manejarRecordatorioManual(req, res);
    case 'recordatorio':
      return manejarRecordatorioAutomatico(req, res);
    default:
      return res.status(400).json({ exito: false, error: 'Parámetro "tipo" inválido o faltante.' });
  }
}
