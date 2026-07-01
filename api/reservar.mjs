import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

  const { nombre, email, telefono, fecha, tour } = req.body;

  if (!nombre || !email || !fecha || !tour) {
    return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios.' });
  }

  try {
    // Inserción limpia usando las columnas exactas creadas en tu base de datos
    const { data, error } = await supabase
      .from('reservas')
      .insert([
        { 
          nombre: nombre, 
          email: email, 
          telefono: telefono, 
          fecha: fecha, 
          tour: tour 
        }
      ])
      .select();

    if (error) {
      return res.status(400).json({ exito: false, error: error.message });
    }
    
    return res.status(200).json({ exito: true, mensaje: '¡Reserva confirmada con éxito!', reserva: data });
  } catch (error) {
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}
