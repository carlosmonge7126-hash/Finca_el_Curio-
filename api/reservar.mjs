import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// ═══════════════════════════════════════════
// Notificaciones "de respaldo" a Google Sheets y Make.com. Antes esto
// vivía en el navegador (index.html), con las URL de los webhooks
// visibles para cualquiera que viera el código fuente. Ahora vive acá,
// del lado del servidor: las URL están en variables de entorno
// (GOOGLE_SHEETS_WEBHOOK_URL / MAKE_WEBHOOK_URL) que nunca se mandan
// al navegador. No bloquean la reserva si fallan.
// 🗑️ Para quitar una integración, borrá su función y su línea de
// llamado más abajo (o simplemente no configures esa variable de
// entorno: si no está seteada, esa notificación se salta sola).
// ═══════════════════════════════════════════
async function notificarGoogleSheets(datos) {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(datos)
    });
  } catch (err) {
    console.warn('⚠️ No se pudo notificar a Google Sheets:', err.message);
  }
}

async function notificarMake(datos) {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos)
    });
  } catch (err) {
    console.warn('⚠️ No se pudo notificar a Make.com:', err.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

  const { nombre, email, telefono, fecha, tour, horario, cantidadPersonas } = req.body;

  if (!nombre || !email || !fecha || !tour) {
    return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios.' });
  }

  try {
    // Inserción limpia usando las columnas exactas creadas en tu base de datos.
    // "horario" y "cantidad_personas" ya vienen calculados desde el navegador
    // (SOLICITUD 3-5: el sistema asigna el horario automáticamente antes de
    // guardar la reserva; el admin solo lo reasigna después si hace falta).
    const { data, error } = await supabase
      .from('reservas')
      .insert([
        { 
          nombre: nombre, 
          email: email, 
          telefono: telefono, 
          fecha: fecha, 
          tour: tour,
          horario: horario || '',
          cantidad_personas: parseInt(cantidadPersonas) || 1
        }
      ])
      .select();

    if (error) {
      return res.status(400).json({ exito: false, error: error.message });
    }

    // Notificaciones de respaldo, en paralelo, sin bloquear la respuesta
    // ni hacer fallar la reserva si alguna de las dos no responde.
    const datosNotif = { nombre, email, telefono, fecha, tour, horario: horario || '', cantidadPersonas: parseInt(cantidadPersonas) || 1 };
    await Promise.all([
      notificarGoogleSheets(datosNotif),
      notificarMake(datosNotif)
    ]);

    return res.status(200).json({ exito: true, mensaje: '¡Reserva confirmada con éxito!', reserva: data });
  } catch (error) {
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}
