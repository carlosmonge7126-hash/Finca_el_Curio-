import { createClient } from '@supabase/supabase-js';
import { exigirAdmin } from './_lib/adminAuth.js';
import {
  obtenerIp, permitir, responderDemasiados, limpiarTexto, limpiarTelefono, esEmailValido,
  esIdValido, exigirJson, errorBD, errorInterno
} from './_lib/seguridad.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // DELETE: elimina un padrino/madrina (botón "🗑 Eliminar" del panel de
  // admin). Se combina en este mismo archivo, en vez de crear un endpoint
  // aparte, porque Vercel Hobby limita a 12 Serverless Functions por
  // despliegue y cada archivo en /api cuenta como una. Solo el admin
  // puede borrar padrinos, así que exige el token acá.
  if (req.method === 'DELETE') {
    if (!exigirAdmin(req, res)) return;
    const { id, email, fecha } = (req.body && typeof req.body === 'object') ? req.body : {};
    if ((id && !esIdValido(id)) || (!id && (typeof email !== 'string' || typeof fecha !== 'string'))) {
      return res.status(400).json({ exito: false, error: 'Identificador no válido.' });
    }
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
      if (error) return errorBD(res, error, 'padrino.delete');
      return res.status(200).json({ exito: true });
    } catch (error) {
      return errorInterno(res, error, 'padrino.delete');
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

  if (!exigirJson(req, res)) return;
  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  const nombre = limpiarTexto(body.nombre, 100);
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const telefono = limpiarTelefono(body.telefono);
  const tipoAporte = limpiarTexto(body.tipoAporte, 300);
  const mensaje = limpiarTexto(body.mensaje, 1000);

  if (!nombre || !email || !tipoAporte) {
    return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios.' });
  }
  if (!esEmailValido(email)) {
    return res.status(400).json({ exito: false, error: 'El correo no es válido.' });
  }
  // Anti-spam: 5 registros por hora por IP
  if (!(await permitir('padrino-ip', obtenerIp(req), 5, 3600))) return responderDemasiados(res);

  try {
    const { error } = await supabase
      .from('padrinos')
      .insert([{ nombre, email, telefono, tipo_aporte: tipoAporte, mensaje }]);

    if (error) return errorBD(res, error, 'padrino.insert');

    // Ya no se devuelve la fila guardada (datos personales) al navegador
    return res.status(200).json({ exito: true, mensaje: '¡Padrino registrado con éxito!' });
  } catch (error) {
    return errorInterno(res, error, 'padrino.insert');
  }
}
