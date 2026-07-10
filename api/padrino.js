import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // DELETE: elimina un padrino/madrina (botón "🗑 Eliminar" del panel de
  // admin). Se combina en este mismo archivo, en vez de crear un endpoint
  // aparte, porque Vercel Hobby limita a 12 Serverless Functions por
  // despliegue y cada archivo en /api cuenta como una.
  if (req.method === 'DELETE') {
    const { id, email, fecha } = req.body || {};
    try {
      let query = supabase.from('padrinos').delete();
      if (id) {
        query = query.eq('id', id);
      } else if (email && fecha) {
        // "fecha" en el cliente es el mismo valor que created_at cuando el
        // registro vino de Supabase (ver descargarPadrinosDesdeSupabase).
        query = query.eq('email', email).eq('created_at', fecha);
      } else {
        return res.status(400).json({ exito: false, error: 'Falta id o email+fecha para identificar el padrino.' });
      }
      const { error } = await query;
      if (error) return res.status(400).json({ exito: false, error: error.message });
      return res.status(200).json({ exito: true });
    } catch (error) {
      return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
    }
  }

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
