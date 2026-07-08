import {
  transporter, credencialesCorreoListas, formatearFecha, linkWhatsApp,
  obtenerBaseUrl, encabezadoCorreo, tarjetaCorreo, filaDato
} from './_lib/correo.js';

// Envía un correo al cliente cuando el ADMIN cancela su reserva desde el
// panel. Se dispara desde index.html -> cancelarReserva() justo después de
// confirmar la cancelación en el modal. No bloquea la UI si falla (el admin
// solo ve un aviso discreto, la cancelación en sí ya quedó guardada).

function plantillaCorreo({ nombre, fecha, horario, tour, lang, telefonoFinca, motivo, baseUrl }) {
  const fechaBonita = formatearFecha(fecha, lang);
  const es = lang !== 'en';
  const titulo = es ? 'Tu reserva fue cancelada' : 'Your reservation was cancelled';
  const saludo = es ? `Hola ${nombre},` : `Hi ${nombre},`;
  const cuerpo = es
    ? `Te escribimos para avisarte que tu visita a <strong>Finca El Curio</strong> que tenías agendada fue <strong>cancelada</strong> por nuestro equipo.`
    : `We're writing to let you know that your upcoming visit to <strong>Finca El Curio</strong> was <strong>cancelled</strong> by our team.`;
  const motivoHtml = (es && motivo)
    ? `<p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;"><strong>Motivo:</strong> ${motivo}</p>`
    : (!es && motivo) ? `<p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;"><strong>Reason:</strong> ${motivo}</p>` : '';
  const lblFecha = es ? 'Fecha que tenías reservada' : 'Date you had booked';
  const lblHora = es ? 'Hora' : 'Time';
  const lblTour = es ? 'Actividad' : 'Activity';
  const waLink = linkWhatsApp(telefonoFinca);
  const waTexto = es ? 'escribinos por WhatsApp' : 'message us on WhatsApp';
  const waEnlace = waLink ? `<a href="${waLink}" style="color:#1f5b32;font-weight:bold;text-decoration:underline;">${waTexto}</a>` : waTexto;
  const despedida = es
    ? `Si querés reagendar tu visita o tenés alguna pregunta, ${waEnlace} o responde este correo. ¡Con gusto te ayudamos a encontrar una nueva fecha!`
    : `If you'd like to reschedule your visit or have any questions, ${waEnlace} or reply to this email. We'd love to help you find a new date!`;
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

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

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
      html: plantillaCorreo({ nombre, fecha, horario, tour, lang, telefonoFinca, motivo, baseUrl })
    });
    return res.status(200).json({ exito: true });
  } catch (error) {
    console.error('Error enviando correo de cancelación:', error);
    return res.status(500).json({ exito: false, error: error.message || 'No se pudo enviar el correo.' });
  }
}
