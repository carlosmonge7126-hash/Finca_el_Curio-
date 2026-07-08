import nodemailer from 'nodemailer';

// Envía un correo al cliente cuando el ADMIN cancela su reserva desde el
// panel. Se dispara desde index.html -> cancelarReserva() justo después de
// confirmar la cancelación en el modal. No bloquea la UI si falla (el admin
// solo ve un aviso discreto, la cancelación en sí ya quedó guardada).
//
// NOTA: este archivo es autocontenido a propósito (no importa nada de
// otros archivos del proyecto). Así evitamos cualquier problema de
// despliegue si una carpeta compartida no llega a subirse completa.

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

function capitalizar(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function formatearFecha(fechaISO, lang) {
  try {
    const d = new Date(fechaISO + 'T00:00:00');
    if (lang === 'en') {
      return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
    const dia = capitalizar(DIAS_ES[d.getDay()]);
    const mes = capitalizar(MESES_ES[d.getMonth()]);
    return `${dia}, ${d.getDate()} de ${mes} de ${d.getFullYear()}`;
  } catch {
    return fechaISO;
  }
}

function linkWhatsApp(telefonoFinca) {
  const numero = (telefonoFinca || '').replace(/\D/g, '');
  if (!numero) return null;
  const conCodigo = numero.startsWith('506') ? numero : `506${numero}`;
  return `https://wa.me/${conCodigo}`;
}

function obtenerBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

// ─────────────────────────────────────────────────────────────
// Encabezado del correo: foto real (<img>) arriba + barra de color
// sólido con el título justo debajo.
//
// Antes esto se hacía con CSS "background-image" sobre un <div>, con
// el texto encima. Gmail (sobre todo en la versión web) no soporta bien
// esa técnica y la ignora, por eso la foto no se veía y el texto
// quedaba flotando sobre un fondo plano. Un <img> normal SIEMPRE se ve
// (es la forma más compatible de mostrar una imagen en un correo), y al
// separar la foto del texto en dos bloques apilados, el texto queda
// legible sin depender de que el cliente de correo sepa componer capas.
// ─────────────────────────────────────────────────────────────
function encabezadoCorreo({ baseUrl, titulo }) {
  return `
    <img src="${baseUrl}/fondo-correo.jpg" alt="Finca El Curio" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;outline:none;text-decoration:none;" />
    <div style="background:linear-gradient(135deg,#0d3b1e,#1f5b32);padding:20px 24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:.5px;">🌿 Finca El Curio</h1>
      <p style="color:#e7f0d9;margin:6px 0 0;font-size:14px;">${titulo}</p>
    </div>`;
}

function filaDato(icono, etiqueta, valor, redondeo) {
  const radio = redondeo === 'arriba' ? '10px 10px 0 0' : redondeo === 'abajo' ? '0 0 10px 10px' : '0';
  const fondo = redondeo === 'abajo' ? '#eae7d8' : '#f1f0e6';
  return `<tr>
    <td style="padding:12px 14px;background:${fondo};border-radius:${radio};font-size:13px;color:#5b5b45;">${icono} ${etiqueta}</td>
    <td style="padding:12px 14px;background:${fondo};border-radius:${radio};font-size:15px;font-weight:bold;color:#0d3b1e;text-align:right;">${valor}</td>
  </tr>`;
}

function plantillaCorreo({ nombre, fecha, horario, tour, lang, telefonoFinca, motivo, baseUrl }) {
  const fechaBonita = formatearFecha(fecha, lang);
  const es = lang !== 'en';
  const titulo = es ? 'Tu reserva fue cancelada' : 'Your reservation was cancelled';
  const saludo = es ? `Hola ${nombre},` : `Hi ${nombre},`;
  const cuerpo = es
    ? `Te escribimos para avisarte que tu visita a <strong>Finca El Curio</strong> que tenías agendada fue <strong>cancelada</strong> por nuestro equipo.`
    : `We're writing to let you know that your upcoming visit to <strong>Finca El Curio</strong> was <strong>cancelled</strong> by our team.`;
  const motivoHtml = motivo
    ? `<p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;"><strong>${es ? 'Motivo' : 'Reason'}:</strong> ${motivo}</p>`
    : '';
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

  const encabezado = encabezadoCorreo({ baseUrl, titulo });
  const filas = `<table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
      ${filaDato('📅', lblFecha, fechaBonita, 'arriba')}
      ${horario ? filaDato('🕐', lblHora, horario, '') : ''}
      ${tour ? filaDato('🌾', lblTour, tour, 'abajo') : ''}
    </table>`;

  return `
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;background:#fdfbf6;border-radius:16px;overflow:hidden;border:1px solid #e4e0d4;">
    ${encabezado}
    <div style="padding:28px 26px;color:#2b2b2b;">
      <p style="font-size:16px;margin:0 0 12px;">${saludo}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">${cuerpo}</p>
      ${motivoHtml}
      ${filas}
      <p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;">${despedida}</p>
      <p style="font-size:14px;color:#1f5b32;font-weight:bold;margin:0;">${firma}</p>
    </div>
  </div>`;
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
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
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
