import nodemailer from 'nodemailer';

// ═══════════════════════════════════════════════════════════
// Módulo compartido por todos los correos que manda el sitio
// (confirmación, cancelación, recordatorio). Vive dentro de
// "_lib" a propósito: los archivos/carpetas que empiezan con "_"
// NO se convierten en endpoints en Vercel, así que esto es solo
// código reutilizable, no una ruta pública.
// ═══════════════════════════════════════════════════════════

// Variables de entorno requeridas en Vercel (ya configuradas para el
// correo de confirmación, se reutilizan aquí):
//   GMAIL_USER          -> finca.el.curio@gmail.com
//   GMAIL_APP_PASSWORD  -> contraseña de aplicación de 16 caracteres
export const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

export function credencialesCorreoListas() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

export function capitalizar(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

export function formatearFecha(fechaISO, lang) {
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

export function linkWhatsApp(telefonoFinca) {
  const numero = (telefonoFinca || '').replace(/\D/g, '');
  if (!numero) return null;
  const conCodigo = numero.startsWith('506') ? numero : `506${numero}`;
  return `https://wa.me/${conCodigo}`;
}

// Devuelve "https://tu-dominio.vercel.app" a partir de la propia
// petición (funciona igual en producción, en previews de Vercel y en
// dominio propio, sin tener que guardar la URL a mano en ningún lado).
export function obtenerBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

// ─────────────────────────────────────────────────────────────
// Imagen de fondo del encabezado de TODOS los correos.
//
// Es una foto fija (el camino empedrado de la finca), servida como
// archivo normal (/fondo-correo.jpg, ~53KB) en vez de incrustada en
// base64 dentro del HTML. Esto es importante para el peso del correo:
// Gmail (y otros) "recortan" los mensajes cuyo HTML pasa de ~102KB y
// muestran un enlace de "Ver mensaje completo" en vez del correo
// entero. Una imagen embebida en base64 cuenta contra ese límite;
// una imagen enlazada por URL NO cuenta (se descarga aparte, como
// cualquier imagen de una página web), así que el correo se mantiene
// liviano sin importar cuántas veces se use esta plantilla.
// ─────────────────────────────────────────────────────────────
function imagenFondoUrl(baseUrl) {
  return `${baseUrl}/fondo-correo.jpg`;
}

// Encabezado: foto real (<img>) arriba + barra de color sólido con el
// título justo debajo. Antes la foto se ponía con CSS "background-image"
// sobre un <div>, con el texto encima. Eso se veía bien en la mayoría de
// clientes de correo web, PERO Outlook de escritorio (que usa el motor de
// Word para pintar el HTML, no un navegador real) prácticamente no soporta
// background-image sin un truco extra (VML), así que ahí la foto
// simplemente no aparecía. Un <img> normal SIEMPRE se ve —es la forma más
// compatible de mostrar una imagen en un correo—, así que unificamos todos
// los correos (reserva, recordatorio, cancelación) con esta misma técnica.
//
// tono: qué tan oscura se ve la barra de color debajo de la foto. "suave"
// = verde un poco más claro (correo de bienvenida/recordatorio); "normal"
// = verde más oscuro, para avisos más serios como cancelaciones.
export function encabezadoCorreo({ baseUrl, titulo, subtitulo, tono = 'suave' }) {
  const gradiente = tono === 'suave'
    ? 'linear-gradient(135deg,#0d3b1e,#1f5b32)'
    : 'linear-gradient(135deg,#0a2e17,#173f24)';

  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:0;margin:0;">
          <img src="${imagenFondoUrl(baseUrl)}" alt="Finca El Curio" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;outline:none;text-decoration:none;" />
        </td>
      </tr>
      <tr>
        <td style="background:${gradiente};padding:20px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:.5px;">🌿 Finca El Curio</h1>
          <p style="color:#e7f0d9;margin:6px 0 0;font-size:14px;">${titulo}</p>
          ${subtitulo ? `<p style="color:#cfe0b8;margin:2px 0 0;font-size:12.5px;">${subtitulo}</p>` : ''}
        </td>
      </tr>
    </table>`;
}

// Envoltorio común (tarjeta blanca redondeada) para el cuerpo de
// cualquier correo. `contenido` es el HTML interior ya armado.
export function tarjetaCorreo(encabezadoHtml, contenidoHtml) {
  return `
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="padding:10px 0;">
    <tr>
      <td align="center">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="520" style="width:100%;max-width:520px;background:#fdfbf6;border-radius:16px;overflow:hidden;border:1px solid #e4e0d4;font-family:Georgia,'Times New Roman',serif;">
          <tr>
            <td style="padding:0;margin:0;">
              ${encabezadoHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 26px;color:#2b2b2b;">
              ${contenidoHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

export function filaDato(icono, etiqueta, valor, redondeo) {
  const radio = redondeo === 'arriba' ? '10px 10px 0 0' : redondeo === 'abajo' ? '0 0 10px 10px' : '0';
  const fondo = redondeo === 'abajo' ? '#eae7d8' : '#f1f0e6';
  return `<tr>
    <td style="padding:12px 14px;background:${fondo};border-radius:${radio};font-size:13px;color:#5b5b45;">${icono} ${etiqueta}</td>
    <td style="padding:12px 14px;background:${fondo};border-radius:${radio};font-size:15px;font-weight:bold;color:#0d3b1e;text-align:right;">${valor}</td>
  </tr>`;
}

// ─────────────────────────────────────────────────────────────
// Plantilla del correo de recordatorio ("¡Nos vemos mañana!").
// Vive acá (compartida) para que la pueda usar tanto el cron
// automático (notificar-recordatorio.js) como el botón de envío
// manual del panel de admin (notificar-recordatorio-manual.js),
// y así ambos manden exactamente el mismo correo.
// ─────────────────────────────────────────────────────────────
export function plantillaRecordatorio({ nombre, fecha, horario, tour, telefonoFinca, baseUrl }) {
  const fechaBonita = formatearFecha(fecha, 'es');
  const titulo = '¡Nos vemos mañana!';
  const saludo = `Hola ${nombre},`;
  const cuerpo = `¡Te esperamos el día de mañana en <strong>Finca El Curio</strong>! Este es un pequeño recordatorio de tu visita.`;
  const waLink = linkWhatsApp(telefonoFinca);
  const waTexto = 'escribinos por WhatsApp';
  const waEnlace = waLink ? `<a href="${waLink}" style="color:#1f5b32;font-weight:bold;text-decoration:underline;">${waTexto}</a>` : waTexto;
  const despedida = `Si necesitás cambiar algo de último momento, ${waEnlace} o responde este correo.`;
  const firma = 'Con cariño, el equipo de Finca El Curio 🌱';

  const encabezado = encabezadoCorreo({ baseUrl, titulo, subtitulo: '¡Te esperamos el día de mañana en Finca El Curio!', tono: 'suave' });
  const filas = `<table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
      ${filaDato('📅', 'Fecha', fechaBonita, 'arriba')}
      ${filaDato('🕐', 'Hora', horario, tour ? '' : 'abajo')}
      ${tour ? filaDato('🌾', 'Actividad', tour, 'abajo') : ''}
    </table>`;
  const cuerpoHtml = `
    <p style="font-size:16px;margin:0 0 12px;">${saludo}</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 22px;">${cuerpo}</p>
    ${filas}
    <p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;">${despedida}</p>
    <p style="font-size:14px;color:#1f5b32;font-weight:bold;margin:0;">${firma}</p>`;

  return tarjetaCorreo(encabezado, cuerpoHtml);
}
