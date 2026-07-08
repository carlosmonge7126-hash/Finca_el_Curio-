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

// tono: qué tan visible se ve la foto de fondo debajo del degradado
// verde. "suave" = degradado más translúcido (se ve más la foto,
// úsalo en el correo de bienvenida/recordatorio); "normal" = un poco
// más opaco para separaciones o avisos delicados como cancelaciones.
export function encabezadoCorreo({ baseUrl, titulo, subtitulo, tono = 'suave' }) {
  const capaOscura = tono === 'suave'
    ? 'linear-gradient(135deg,rgba(13,59,30,.62),rgba(31,91,50,.5))'
    : 'linear-gradient(135deg,rgba(13,59,30,.78),rgba(31,91,50,.68))';
  const fondo = `background-image:${capaOscura},url('${imagenFondoUrl(baseUrl)}');background-size:cover;background-position:center;`;
  return `
    <div style="${fondo}padding:32px 24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:.5px;text-shadow:0 2px 10px rgba(0,0,0,.55);">🌿 Finca El Curio</h1>
      <p style="color:#e7f0d9;margin:6px 0 0;font-size:14px;text-shadow:0 2px 8px rgba(0,0,0,.55);">${titulo}</p>
      ${subtitulo ? `<p style="color:#cfe0b8;margin:2px 0 0;font-size:12.5px;text-shadow:0 2px 8px rgba(0,0,0,.55);">${subtitulo}</p>` : ''}
    </div>`;
}

// Envoltorio común (tarjeta blanca redondeada) para el cuerpo de
// cualquier correo. `contenido` es el HTML interior ya armado.
export function tarjetaCorreo(encabezadoHtml, contenidoHtml) {
  return `
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;background:#fdfbf6;border-radius:16px;overflow:hidden;border:1px solid #e4e0d4;">
    ${encabezadoHtml}
    <div style="padding:28px 26px;color:#2b2b2b;">
      ${contenidoHtml}
    </div>
  </div>`;
}

export function filaDato(icono, etiqueta, valor, redondeo) {
  const radio = redondeo === 'arriba' ? '10px 10px 0 0' : redondeo === 'abajo' ? '0 0 10px 10px' : '0';
  const fondo = redondeo === 'abajo' ? '#eae7d8' : '#f1f0e6';
  return `<tr>
    <td style="padding:12px 14px;background:${fondo};border-radius:${radio};font-size:13px;color:#5b5b45;">${icono} ${etiqueta}</td>
    <td style="padding:12px 14px;background:${fondo};border-radius:${radio};font-size:15px;font-weight:bold;color:#0d3b1e;text-align:right;">${valor}</td>
  </tr>`;
}
