import {
  transporter, credencialesCorreoListas, formatearFecha, linkWhatsApp,
  obtenerBaseUrl, encabezadoCorreo, tarjetaCorreo, filaDato
} from './_lib/correo.js';

// Envía el correo de confirmación al cliente cuando el admin le asigna
// fecha/hora a su reserva. Usa Gmail SMTP con una "contraseña de aplicación"
// (App Password), NO la contraseña normal de la cuenta.

function plantillaCorreo({ nombre, fecha, horario, tour, lang, telefonoFinca, baseUrl }) {
  const fechaBonita = formatearFecha(fecha, lang);
  const es = lang !== 'en';
  const titulo = es ? '¡Reserva confirmada!' : 'Reservation confirmed!';
  const saludo = es ? `Hola ${nombre},` : `Hi ${nombre},`;
  const cuerpo = es
    ? `Tu visita a <strong>Finca El Curio</strong> ya tiene fecha y hora asignada. ¡Te esperamos!`
    : `Your visit to <strong>Finca El Curio</strong> now has a confirmed date and time. We can't wait to see you!`;
  const lblFecha = es ? 'Fecha' : 'Date';
  const lblHora = es ? 'Hora' : 'Time';
  const lblTour = es ? 'Actividad' : 'Activity';
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
      ${tour ? filaDato('🌾', lblTour, tour, 'abajo') : ''}
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

  const { email, nombre, fecha, horario, tour, lang, telefonoFinca } = req.body || {};
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
      html: plantillaCorreo({ nombre, fecha, horario, tour, lang, telefonoFinca, baseUrl })
    });
    return res.status(200).json({ exito: true });
  } catch (error) {
    console.error('Error enviando correo de confirmación:', error);
    return res.status(500).json({ exito: false, error: error.message || 'No se pudo enviar el correo.' });
  }
}
