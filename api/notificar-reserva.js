import nodemailer from 'nodemailer';

// Envía el correo de confirmación al cliente cuando el admin le asigna
// fecha/hora a su reserva. Usa Gmail SMTP con una "contraseña de aplicación"
// (App Password), NO la contraseña normal de la cuenta.
//
// Variables de entorno requeridas en Vercel:
//   GMAIL_USER          -> finca.el.curio@gmail.com
//   GMAIL_APP_PASSWORD  -> contraseña de aplicación de 16 caracteres

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
    // Formato manual en español para controlar exactamente las mayúsculas:
    // tanto el día de la semana como el mes con inicial mayúscula.
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

function plantillaCorreo({ nombre, fecha, horario, tour, lang, telefonoFinca }) {
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

  return `
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;background:#fdfbf6;border-radius:16px;overflow:hidden;border:1px solid #e4e0d4;">
    <div style="background:linear-gradient(135deg,#0d3b1e,#1f5b32);padding:28px 24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:.5px;">🌿 Finca El Curio</h1>
      <p style="color:#a8c45a;margin:6px 0 0;font-size:14px;">${titulo}</p>
    </div>
    <div style="padding:28px 26px;color:#2b2b2b;">
      <p style="font-size:16px;margin:0 0 12px;">${saludo}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 22px;">${cuerpo}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
        <tr>
          <td style="padding:12px 14px;background:#f1f0e6;border-radius:10px 10px 0 0;font-size:13px;color:#5b5b45;">📅 ${lblFecha}</td>
          <td style="padding:12px 14px;background:#f1f0e6;border-radius:10px 10px 0 0;font-size:15px;font-weight:bold;color:#0d3b1e;text-align:right;">${fechaBonita}</td>
        </tr>
        <tr>
          <td style="padding:12px 14px;background:#eae7d8;font-size:13px;color:#5b5b45;">🕐 ${lblHora}</td>
          <td style="padding:12px 14px;background:#eae7d8;font-size:15px;font-weight:bold;color:#0d3b1e;text-align:right;">${horario}</td>
        </tr>
        ${tour ? `<tr>
          <td style="padding:12px 14px;background:#f1f0e6;border-radius:0 0 10px 10px;font-size:13px;color:#5b5b45;">🌾 ${lblTour}</td>
          <td style="padding:12px 14px;background:#f1f0e6;border-radius:0 0 10px 10px;font-size:15px;font-weight:bold;color:#0d3b1e;text-align:right;">${tour}</td>
        </tr>` : ''}
      </table>
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

  const { email, nombre, fecha, horario, tour, lang, telefonoFinca } = req.body || {};
  if (!email || !nombre || !fecha || !horario) {
    return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios (email, nombre, fecha, horario).' });
  }
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({ exito: false, error: 'Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD en el servidor.' });
  }

  const esEs = lang !== 'en';
  const asunto = esEs
    ? `✅ Confirmación de tu reserva en Finca El Curio — ${fecha}`
    : `✅ Your Finca El Curio reservation is confirmed — ${fecha}`;

  try {
    await transporter.sendMail({
      from: `"Finca El Curio" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: asunto,
      html: plantillaCorreo({ nombre, fecha, horario, tour, lang, telefonoFinca })
    });
    return res.status(200).json({ exito: true });
  } catch (error) {
    console.error('Error enviando correo de confirmación:', error);
    return res.status(500).json({ exito: false, error: error.message || 'No se pudo enviar el correo.' });
  }
}
