import {
  transporter, credencialesCorreoListas, formatearFecha, linkWhatsApp,
  obtenerBaseUrl, encabezadoCorreo, tarjetaCorreo, filaDato
} from './_lib/correo.js';

// Envía el correo de "reserva reasignada" al cliente cuando el admin
// cambia la fecha y/o el horario de una reserva que ya había sido
// confirmada antes. Es un correo DISTINTO al de "reserva creada"
// (SOLICITUD 6), para que quede claro que se trata de un cambio y no
// de una reserva nueva. Usa el mismo transporte de Gmail que el resto
// de los correos del sitio.

function plantillaCorreo({ nombre, fecha, horario, tour, personas, lang, telefonoFinca, baseUrl }) {
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

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

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
      html: plantillaCorreo({ nombre, fecha, horario, tour, personas, lang, telefonoFinca, baseUrl })
    });
    return res.status(200).json({ exito: true });
  } catch (error) {
    console.error('Error enviando correo de reasignación:', error);
    return res.status(500).json({ exito: false, error: error.message || 'No se pudo enviar el correo.' });
  }
}
