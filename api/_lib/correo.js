import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Content-ID fijo para la imagen de encabezado. Al ir "adjunta" en el
// propio correo (en vez de cargada desde una URL externa), el cliente
// de correo (Outlook, Gmail, etc.) la muestra siempre, sin bloquearla
// por privacidad y sin depender de que el dominio público esté
// accesible en el momento del envío.
export const LOGO_CID = 'logo-finca-el-curio';

// Adjunto reutilizable con la imagen de encabezado. Se agrega al
// arreglo "attachments" de cada sendMail junto al resto del correo.
export function adjuntoLogo() {
  return {
    filename: 'fondo-correo.jpg',
    path: path.join(__dirname, '..', '..', 'fondo-correo.jpg'),
    cid: LOGO_CID
  };
}

// ═══════════════════════════════════════════════════════════
// Módulo compartido por todos los correos que manda el sitio
// (confirmación, cancelación, recordatorio). Vive dentro de
// "_lib" a propósito: los archivos/carpetas que empiezan con "_"
// NO se convierten en endpoints en Vercel, así que esto es solo
// código reutilizable, no una ruta pública.
// ═══════════════════════════════════════════════════════════

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

export function obtenerBaseUrl(req) {
  // Preferimos SITE_URL (variable de entorno fija con el dominio real).
  // Es clave para el cron de recordatorios: esas requests las dispara
  // Vercel directo contra la URL de despliegue (*.vercel.app), que está
  // protegida por Vercel Authentication. Si armamos el link de la imagen
  // con ese host, el cliente de correo no puede descargarla (401).
  // Con SITE_URL forzamos siempre el dominio público real.
  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/+$/, '');
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function imagenFondoUrl(baseUrl) {
  // "baseUrl" ya no se usa para la imagen (ver adjuntoLogo/LOGO_CID más
  // arriba); se deja el parámetro por compatibilidad con las llamadas
  // existentes a encabezadoCorreo({ baseUrl, ... }).
  return `cid:${LOGO_CID}`;
}

// ─────────────────────────────────────────────────────────────
// Encabezado corregido: usa colores sólidos de fondo (#1f5b32 / #0d3b1e)
// para garantizar que los títulos sean SIEMPRE visibles en todos
// los clientes de correo (Outlook, Gmail, Apple Mail).
// ─────────────────────────────────────────────────────────────
export function encabezadoCorreo({ baseUrl, titulo, subtitulo, tono = 'suave' }) {
  const fondoVerde = tono === 'suave' ? '#1f5b32' : '#0d3b1e';

  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:0;margin:0;">
          <img src="${imagenFondoUrl(baseUrl)}" alt="Finca El Curio" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;outline:none;text-decoration:none;" />
        </td>
      </tr>
      <tr>
        <td style="background-color:${fondoVerde} !important;padding:20px 24px;text-align:center;">
          <h1 style="margin:0;font-size:22px;letter-spacing:.5px;">
            <span style="color:#ffffff !important;text-decoration:none;">🌿 Finca El Curio</span>
          </h1>
          <p style="margin:6px 0 0;font-size:15px;font-weight:bold;">
            <span style="color:#ffffff !important;text-decoration:none;">${titulo}</span>
          </p>
          ${subtitulo ? `
          <p style="margin:4px 0 0;font-size:13px;">
            <span style="color:#e7f0d9 !important;text-decoration:none;">${subtitulo}</span>
          </p>` : ''}
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

export function plantillaRecuperacion({ codigo, baseUrl }) {
  const titulo = '🔐 Código de recuperación';
  const encabezado = encabezadoCorreo({ baseUrl, titulo, tono: 'normal' });
  const cuerpoHtml = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">Recibimos una solicitud para cambiar la contraseña de tu cuenta en <strong>Finca El Curio</strong>. Usá este código para continuar:</p>
    <p style="text-align:center;margin:0 0 18px;">
      <span style="display:inline-block;background:#f1f0e6;border-radius:10px;padding:14px 26px;font-size:28px;font-weight:bold;letter-spacing:6px;color:#0d3b1e;">${codigo}</span>
    </p>
    <p style="font-size:13px;line-height:1.6;color:#777;margin:0;">El código vence en 15 minutos. Si no fuiste vos quien lo pidió, podés ignorar este correo con tranquilidad: tu contraseña no cambia a menos que se use este código.</p>`;
  return tarjetaCorreo(encabezado, cuerpoHtml);
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

  const encabezado = encabezadoCorreo({ baseUrl, titulo, tono: 'suave' });
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
