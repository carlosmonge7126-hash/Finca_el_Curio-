import { createClient } from '@supabase/supabase-js';
import { exigirAdmin } from './_lib/adminAuth.js';
import {
  limpiarTexto, esEmailValido, esFechaISO, esIdValido, entero, exigirJson, errorBD, errorInterno
} from './_lib/seguridad.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// Actualiza una reserva ya existente (asignar/cambiar horario, mover fecha).
// Usa la SERVICE_ROLE_KEY porque la tabla "reservas" no tiene política de
// UPDATE para "anon".
//
// SEGURIDAD: ahora es SOLO ADMIN. Antes, cualquier visitante podía llamar
// este endpoint para marcar la bandera "correo enviado" de cualquier reserva.
// Esa bandera ahora la marca el propio servidor (/api/notificar?tipo=reserva)
// cuando manda el correo de confirmación.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }
  if (!exigirJson(req, res)) return;
  if (!exigirAdmin(req, res)) return;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const { id, email, fecha, nuevaFecha, cantidadPersonas, correoConfirmacionEnviado } = body;
  const horario = body.horario === undefined ? undefined : limpiarTexto(body.horario, 40);

  if (horario === undefined) {
    return res.status(400).json({ exito: false, error: 'Falta el horario.' });
  }
  if (nuevaFecha && !esFechaISO(nuevaFecha)) {
    return res.status(400).json({ exito: false, error: 'La nueva fecha no es válida.' });
  }

  const patch = { horario };
  if (nuevaFecha) patch.fecha = nuevaFecha;
  if (cantidadPersonas !== undefined && cantidadPersonas !== null) patch.cantidad_personas = entero(cantidadPersonas, 1, 500, 1);
  if (correoConfirmacionEnviado !== undefined) patch.correo_confirmacion_enviado = !!correoConfirmacionEnviado;

  try {
    let query = supabase.from('reservas').update(patch);

    if (id) {
      if (!esIdValido(id)) return res.status(400).json({ exito: false, error: 'Identificador no válido.' });
      query = query.eq('id', id);
    } else if (email && fecha) {
      // Compatibilidad con reservas viejas guardadas antes de tener "id" local
      if (!esEmailValido(email) || !esFechaISO(fecha)) {
        return res.status(400).json({ exito: false, error: 'Identificador no válido.' });
      }
      query = query.eq('email', email).eq('fecha', fecha);
    } else {
      return res.status(400).json({ exito: false, error: 'Falta id o email+fecha para identificar la reserva.' });
    }

    const { data, error } = await query.select('id');
    if (error) return errorBD(res, error, 'reserva-actualizar');

    return res.status(200).json({ exito: true, reserva: data });
  } catch (error) {
    return errorInterno(res, error, 'reserva-actualizar');
  }
}
