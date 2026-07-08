import { createClient } from '@supabase/supabase-js';
import {
  transporter, credencialesCorreoListas, obtenerBaseUrl, plantillaRecordatorio
} from './_lib/correo.js';

// Solo se crea el cliente de Supabase si hay credenciales configuradas;
// si no las hay, el correo igual se manda, simplemente no se marca
// "recordatorio_enviado" en la base de datos.
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// ═══════════════════════════════════════════════════════════
// Envío MANUAL del correo de recordatorio, disparado por el admin desde
// el botón "📧 Recordatorio" en el panel (una reserva a la vez).
//
// Existe porque el cron automático (notificar-recordatorio.js) corre una
// sola vez al día (9am hora CR) y revisa "¿quién tiene reserva para
// mañana?". Si un cliente reserva para el día siguiente DESPUÉS de esa
// hora, la reserva todavía no existía cuando el cron pasó, así que nunca
// recibe el recordatorio automático (la próxima corrida ya busca la
// fecha siguiente, no esa). Este endpoint manda exactamente el mismo
// correo, a demanda, para cubrir esos casos.
// ═══════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

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

    // Marcamos recordatorio_enviado = true para que el cron automático no
    // le mande un segundo recordatorio a esta misma reserva más adelante.
    // No bloquea la respuesta si esto falla: el correo ya se mandó.
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
