import { createClient } from '@supabase/supabase-js';
import {
  transporter, credencialesCorreoListas, formatearFecha, linkWhatsApp,
  obtenerBaseUrl, encabezadoCorreo, tarjetaCorreo, filaDato, plantillaRecordatorio
} from './_lib/correo.js';

// ═══════════════════════════════════════════════════════════
// Endpoint UNIFICADO de notificaciones por correo.
//
// Antes existían 5 archivos separados en /api (notificar-reserva.js,
// notificar-reserva-reasignada.js, notificar-cancelacion.js,
// notificar-recordatorio.js, notificar-recordatorio-manual.js). Cada
// archivo en /api cuenta como una "Serverless Function" independiente
// en Vercel, y el plan Hobby solo permite 12 por despliegue. Al sumar
// el resto de endpoints del sitio (clientes, login, register,
// reserva-actualizar, reserva-eliminar, reservar, padrino, test) se
// llegaba a 13 y el build fallaba.
//
// Este archivo une los 5 en uno solo (misma lógica, mismas plantillas
// de correo, mismo comportamiento) y elige cuál correo mandar según
// el parámetro "tipo" en la URL: /api/notificar?tipo=reserva
//
// Tipos disponibles:
//   ?tipo=reserva              -> antes notificar-reserva.js
//   ?tipo=reserva-reasignada   -> antes notificar-reserva-reasignada.js
//   ?tipo=cancelacion          -> antes notificar-cancelacion.js
//   ?tipo=recordatorio-manual  -> antes notificar-recordatorio-manual.js
//   ?tipo=recordatorio         -> antes notificar-recordatorio.js (cron diario)
// ═══════════════════════════════════════════════════════════

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// ───────────────────────────────────────────────────────────
// tipo=reserva  (confirmación de reserva con fecha/hora asignada)
// ───────────────────────────────────────────────────────────
function plantillaReserva({ nombre, fecha, horario, tour, personas, lang, telefonoFinca, baseUrl }) {
  const fechaBonita = formatearFecha(fecha, lang);
  const es = lang !== 'en';
  // Reemplaza tus dos líneas originales del título por estas dos:
const tituloTexto = es ? '¡Reserva confirmada!' : 'Reservation confirmed!';
const titulo = `<span style="color:#1c2815; font-weight:bold;">${tituloTexto}</span>`;
  const saludo = es ? `Hola ${nombre},` : `Hi ${nombre},`;
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

async function manejarReserva(req, res) {
  const { email, nombre, fecha, horario, tour, personas, lang, telefonoFinca } = req.body || {};
  if (!email || !nombre || !fecha || !horario) {
    return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios (email, nombre, fecha, horario).' });
  }
  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD en el servidor.' });
  }

  const esEs = lang !== 'en';
  const asunto = esEs
    ? `✅ Confirmación de tu reserva en Finca El Curio — ${fecha}`
    : `✅ Your Finca El Curio reservation is confirmed — ${fecha}`;
  const baseUrl = obtenerBaseUrl(req);

  try {
    await transporter.sendMail({
      from: `"Finca El Curio" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: asunto,
      html: plantillaReserva({ nombre, fecha, horario, tour, personas, lang, telefonoFinca, baseUrl })
    });
    return res.status(200).json({ exito: true });
  } catch (error) {
    console.error('Error enviando correo de confirmación:', error);
    return res.status(500).json({ exito: false, error: error.message || 'No se pudo enviar el correo.' });
  }
}

// ───────────────────────────────────────────────────────────
// tipo=reserva-reasignada  (cambio de fecha/hora de una reserva ya confirmada)
// ───────────────────────────────────────────────────────────
function plantillaReservaReasignada({ nombre, fecha, horario, tour, personas, lang, telefonoFinca, baseUrl }) {
  const fechaBonita = formatearFecha(fecha, lang);
  const es = lang !== 'en';
  const titulo = es ? 'Tu reserva ha sido reasignada' : 'Your booking has been rescheduled';
  const saludo = es ? `Hola ${nombre},` : `Hi ${nombre},`;
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
  const { email, nombre, fecha, horario, tour, personas, lang, telefonoFinca } = req.body || {};
  if (!email || !nombre || !fecha || !horario) {
    return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios (email, nombre, fecha, horario).' });
  }
  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD en el servidor.' });
  }

  const esEs = lang !== 'en';
  const asunto = esEs
    ? `🔄 Tu reserva en Finca El Curio fue reasignada — ${fecha}`
    : `🔄 Your Finca El Curio reservation was rescheduled — ${fecha}`;
  const baseUrl = obtenerBaseUrl(req);

  try {
    await transporter.sendMail({
      from: `"Finca El Curio" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: asunto,
      html: plantillaReservaReasignada({ nombre, fecha, horario, tour, personas, lang, telefonoFinca, baseUrl })
    });
    return res.status(200).json({ exito: true });
  } catch (error) {
    console.error('Error enviando correo de reasignación:', error);
    return res.status(500).json({ exito: false, error: error.message || 'No se pudo enviar el correo.' });
  }
}

// ───────────────────────────────────────────────────────────
// tipo=cancelacion  (aviso de cancelación de una reserva)
// ───────────────────────────────────────────────────────────
function plantillaCancelacion({ nombre, fecha, horario, tour, lang, telefonoFinca, motivo, baseUrl }) {
  const fechaBonita = formatearFecha(fecha, lang);
  const es = lang !== 'en';
  const titulo = es ? 'Tu reserva fue cancelada' : 'Your reservation was cancelled';
  const saludo = es ? `Hola ${nombre},` : `Hi ${nombre},`;
  const cuerpo = es
    ? `Te escribimos para informarte que tu visita a <strong>Finca El Curio</strong> que tenías agendada fue <strong>cancelada</strong> por nuestro equipo.`
    : `We are writing to inform you that your scheduled visit to <strong>Finca El Curio</strong> has been <strong>canceled</strong> by our team.`;
  const motivoHtml = motivo
    ? `<p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;"><strong>${es ? 'Motivo' : 'Reason'}:</strong> ${motivo}</p>`
    : '';
  const lblFecha = es ? 'Fecha que tenías reservada' : 'Date you had booked';
  const lblHora = es ? 'Hora' : 'Time';
  const lblTour = es ? 'Actividad' : 'Activity';
  const waLink = linkWhatsApp(telefonoFinca);
  const waTexto = es ? 'escríbenos por WhatsApp' : 'message us on WhatsApp';
  const waEnlace = waLink ? `<a href="${waLink}" style="color:#1f5b32;font-weight:bold;text-decoration:underline;">${waTexto}</a>` : waTexto;
  const despedida = es
    ? `Reagenda tu visita ingresando a http://finca-elcurio.vercel.app/#reservas, respondiendo este correo o ${waEnlace}. ¡Con gusto te ayudaremos a encontrar una nueva fecha!`
    : `Reschedule your visit by going to http://finca-elcurio.vercel.app/#reservas, replying to this email, or ${waEnlace}. We will gladly help you find a new date!`;
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
  const { email, nombre, fecha, horario, tour, lang, telefonoFinca, motivo } = req.body || {};
  if (!email || !nombre || !fecha) {
    return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios (email, nombre, fecha).' });
  }
  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD en el servidor.' });
  }

  const esEs = lang !== 'en';
  const asunto = esEs
    ? `❌ Tu reserva en Finca El Curio fue cancelada — ${fecha}`
    : `❌ Your Finca El Curio reservation was cancelled — ${fecha}`;
  const baseUrl = obtenerBaseUrl(req);

  try {
    await transporter.sendMail({
      from: `"Finca El Curio" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: asunto,
      html: plantillaCancelacion({ nombre, fecha, horario, tour, lang, telefonoFinca, motivo, baseUrl })
    });
    return res.status(200).json({ exito: true });
  } catch (error) {
    console.error('Error enviando correo de cancelación:', error);
    return res.status(500).json({ exito: false, error: error.message || 'No se pudo enviar el correo.' });
  }
}

// ───────────────────────────────────────────────────────────
// tipo=recordatorio-manual  (botón "📧 Recordatorio" del panel admin)
// ───────────────────────────────────────────────────────────
async function manejarRecordatorioManual(req, res) {
  const { id, email, nombre, fecha, horario, tour, telefonoFinca } = req.body || {};
  if (!email || !nombre || !fecha || !horario) {
    return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios (email, nombre, fecha, horario).' });
  }
  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD en el servidor.' });
  }

  const baseUrl = obtenerBaseUrl(req);

  try {
    await transporter.sendMail({
      from: `"Finca El Curio" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `🌿 ¡Te esperamos pronto en Finca El Curio! — ${fecha}`,
      html: plantillaRecordatorio({ nombre, fecha, horario, tour, telefonoFinca, baseUrl })
    });

    if (id && supabase) {
      supabase.from('reservas').update({ recordatorio_enviado: true }).eq('id', id)
        .then(({ error }) => {
          if (error) console.warn('⚠️ No se pudo marcar recordatorio_enviado:', error.message);
        });
    }

    return res.status(200).json({ exito: true });
  } catch (error) {
    console.error('Error enviando recordatorio manual:', error);
    return res.status(500).json({ exito: false, error: error.message || 'No se pudo enviar el correo.' });
  }
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
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ exito: false, error: 'No autorizado' });
    }
  }

  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD en el servidor.' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !supabase) {
    return res.status(500).json({ exito: false, error: 'Falta configurar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el servidor.' });
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
    if (cfgFila?.valor) telefonoFinca = JSON.parse(cfgFila.valor)?.telefono || null;
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
      console.error('Error consultando reservas para recordatorio:', error);
      return res.status(500).json({ exito: false, error: error.message });
    }

    const resultados = [];
    for (const r of reservas || []) {
      try {
        await transporter.sendMail({
          from: `"Finca El Curio" <${process.env.GMAIL_USER}>`,
          to: r.email,
          subject: `🌿 ¡Te esperamos mañana en Finca El Curio! — ${r.fecha}`,
          html: plantillaRecordatorio({ nombre: r.nombre, fecha: r.fecha, horario: r.horario, tour: r.tour, telefonoFinca, baseUrl })
        });
        await supabase.from('reservas').update({ recordatorio_enviado: true }).eq('id', r.id);
        resultados.push({ id: r.id, email: r.email, exito: true });
      } catch (err) {
        console.error(`Error enviando recordatorio a ${r.email}:`, err);
        resultados.push({ id: r.id, email: r.email, exito: false, error: err.message });
      }
    }

    return res.status(200).json({ exito: true, fecha, enviados: resultados.filter(r => r.exito).length, total: resultados.length, detalle: resultados });
  } catch (error) {
    console.error('Error general en recordatorios:', error);
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}

// ───────────────────────────────────────────────────────────
// Router principal: decide qué correo mandar según ?tipo=
// ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

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
      // El cron de Vercel llama esto por GET, así que no se restringe el método aquí.
      return manejarRecordatorioAutomatico(req, res);
    default:
      return res.status(400).json({ exito: false, error: 'Parámetro "tipo" inválido o faltante. Usa uno de: reserva, reserva-reasignada, cancelacion, recordatorio-manual, recordatorio.' });
  }
}
