import { createClient } from '@supabase/supabase-js';
import { esPeticionAdmin } from './_lib/adminAuth.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Actualiza una reserva ya existente (asignar/cambiar horario, mover fecha).
// Usa la SERVICE_ROLE_KEY porque la tabla "reservas" no tiene política de
// UPDATE para "anon" (solo lectura pública + inserción vía /api/reservar).
//
// El único caso en que esto se llama SIN admin logueado es justo
// después de que un visitante crea su propia reserva, para marcar
// que ya se le mandó el correo de confirmación — por eso solo esa
// bandera queda abierta a cualquiera; cambiar el horario, la fecha o
// la cantidad de personas de una reserva EXISTENTE sí requiere admin.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

  const { id, email, fecha, horario, nuevaFecha, cantidadPersonas, correoConfirmacionEnviado } = req.body;
  const esAdmin = esPeticionAdmin(req);

  if (!esAdmin && (horario !== undefined || nuevaFecha || cantidadPersonas !== undefined)) {
    return res.status(401).json({ exito: false, error: 'No autorizado.' });
  }
  if (esAdmin && !horario && horario !== '') {
    return res.status(400).json({ exito: false, error: 'Falta el horario.' });
  }

  const patch = {};
  if (esAdmin) {
    patch.horario = horario;
    if (nuevaFecha) patch.fecha = nuevaFecha;
    if (cantidadPersonas !== undefined && cantidadPersonas !== null) patch.cantidad_personas = parseInt(cantidadPersonas) || 1;
  }
  if (correoConfirmacionEnviado !== undefined) patch.correo_confirmacion_enviado = !!correoConfirmacionEnviado;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ exito: false, error: 'Nada para actualizar.' });
  }

  try {
    let query = supabase.from('reservas').update(patch);

    if (id) {
      query = query.eq('id', id);
    } else if (email && fecha) {
      // Compatibilidad con reservas viejas guardadas antes de tener "id" local
      query = query.eq('email', email).eq('fecha', fecha);
    } else {
      return res.status(400).json({ exito: false, error: 'Falta id o email+fecha para identificar la reserva.' });
    }

    const { data, error } = await query.select();
    if (error) return res.status(400).json({ exito: false, error: error.message });

    return res.status(200).json({ exito: true, reserva: data });
  } catch (error) {
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}
