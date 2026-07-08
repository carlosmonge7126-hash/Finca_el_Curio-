import { createClient } from '@supabase/supabase-js';
import {
  transporter, credencialesCorreoListas, formatearFecha, linkWhatsApp,
  obtenerBaseUrl, encabezadoCorreo, tarjetaCorreo, filaDato
} from './_lib/correo.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ═══════════════════════════════════════════════════════════
// Recordatorio automático 1 día antes de la visita.
//
// Lo dispara un Vercel Cron Job (ver "crons" en vercel.json), una vez al
// día. Busca en Supabase las reservas cuya fecha sea "mañana" (calculado en
// hora de Costa Rica, no en UTC del servidor) y que ya tengan horario
// asignado, les manda el correo de recordatorio y marca
// "recordatorio_enviado = true" para no volver a mandarlo si el cron
// corre más de una vez ese día.
//
// Requiere la columna nueva `recordatorio_enviado` en la tabla `reservas`
// (agregada en supabase_schema.sql). Usa las mismas variables de entorno
// que ya existen: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER,
// GMAIL_APP_PASSWORD.
// ═══════════════════════════════════════════════════════════

function fechaManana() {
  // "Hoy" según la hora de Costa Rica (no la del servidor, que en Vercel
  // corre en UTC) + 1 día, en formato YYYY-MM-DD para comparar contra la
  // columna `fecha` (tipo date) de Supabase.
  const hoyCR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Costa_Rica' }));
  hoyCR.setDate(hoyCR.getDate() + 1);
  const y = hoyCR.getFullYear();
  const m = String(hoyCR.getMonth() + 1).padStart(2, '0');
  const d = String(hoyCR.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function plantillaCorreo({ nombre, fecha, horario, tour, telefonoFinca, baseUrl }) {
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

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // Vercel agrega automáticamente este header en las llamadas del propio
  // Cron Job cuando defines CRON_SECRET en las variables de entorno. Si lo
  // configuraste, cualquier otra llamada sin el secreto correcto se
  // rechaza (evita que alguien más dispare correos masivos golpeando esta
  // URL). Si no configuraste CRON_SECRET, este chequeo simplemente se
  // salta (sigue funcionando, pero sin esa capa extra de protección).
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ exito: false, error: 'No autorizado' });
    }
  }

  if (!credencialesCorreoListas()) {
    return res.status(500).json({ exito: false, error: 'Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD en el servidor.' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ exito: false, error: 'Falta configurar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el servidor.' });
  }

  const fecha = fechaManana();
  const baseUrl = obtenerBaseUrl(req);

  // Teléfono de la finca (para el link de WhatsApp del correo), guardado
  // en configuracion_sitio -> cfg_general por el panel de admin. Si no se
  // puede leer, el correo simplemente se manda sin ese enlace.
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
    // Solo recordamos reservas que ya tienen horario asignado (si no lo
    // tienen, todavía no hay nada concreto que confirmarle al cliente) y
    // que no se les haya mandado ya el recordatorio.
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
          html: plantillaCorreo({ nombre: r.nombre, fecha: r.fecha, horario: r.horario, tour: r.tour, telefonoFinca, baseUrl })
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
