import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

  const { nombre, email, telefono, tipoAporte, mensaje } = req.body;

  if (!nombre || !email || !tipoAporte) {
    return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios.' });
  }

  try {
    const { data, error } = await supabase
      .from('padrinos')
      .insert([
        {
          nombre: nombre,
          email: email,
          telefono: telefono,
          tipo_aporte: tipoAporte,
          mensaje: mensaje || ''
        }
      ])
      .select();

    if (error) {
      return res.status(400).json({ exito: false, error: error.message });
    }

    return res.status(200).json({ exito: true, mensaje: '¡Padrino registrado con éxito!', padrino: data });
  } catch (error) {
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}
