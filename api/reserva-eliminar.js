import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Elimina una reserva de Supabase (cuando se cancela o se marca como
// completada desde el admin, para que no reaparezca al sincronizar).
// Usa la SERVICE_ROLE_KEY porque "reservas" no tiene política de DELETE
// para "anon".
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

  const { id, email, fecha } = req.body;

  try {
    let query = supabase.from('reservas').delete();

    if (id) {
      query = query.eq('id', id);
    } else if (email && fecha) {
      query = query.eq('email', email).eq('fecha', fecha);
    } else {
      return res.status(400).json({ exito: false, error: 'Falta id o email+fecha para identificar la reserva.' });
    }

    const { error } = await query;
    if (error) return res.status(400).json({ exito: false, error: error.message });

    return res.status(200).json({ exito: true });
  } catch (error) {
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}
