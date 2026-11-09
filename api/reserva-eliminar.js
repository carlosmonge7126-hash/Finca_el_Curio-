import { createClient } from '@supabase/supabase-js';
import { exigirAdmin } from './_lib/adminAuth.js';
import { esEmailValido, esFechaISO, esIdValido, exigirJson, errorBD, errorInterno } from './_lib/seguridad.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// Elimina una reserva de Supabase (cuando se cancela o se marca como
// completada desde el admin, para que no reaparezca al sincronizar).
// Usa la SERVICE_ROLE_KEY porque "reservas" no tiene política de DELETE
// para "anon". Solo el panel de admin cancela/completa reservas, así
// que este endpoint exige el token de admin.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }
  if (!exigirJson(req, res)) return;
  if (!exigirAdmin(req, res)) return;

  const { id, email, fecha } = (req.body && typeof req.body === 'object') ? req.body : {};

  try {
    let query = supabase.from('reservas').delete();

    if (id) {
      if (!esIdValido(id)) return res.status(400).json({ exito: false, error: 'Identificador no válido.' });
      query = query.eq('id', id);
    } else if (email && fecha) {
      if (!esEmailValido(email) || !esFechaISO(fecha)) return res.status(400).json({ exito: false, error: 'Identificador no válido.' });
      query = query.eq('email', email).eq('fecha', fecha);
    } else {
      return res.status(400).json({ exito: false, error: 'Falta id o email+fecha para identificar la reserva.' });
    }

    const { error } = await query;
    if (error) return errorBD(res, error, 'reserva-eliminar');

    return res.status(200).json({ exito: true });
  } catch (error) {
    return errorInterno(res, error, 'reserva-eliminar');
  }
}
