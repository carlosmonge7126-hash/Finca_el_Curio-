import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Convierte una fila de la tabla a la forma que espera el frontend
// (y evita mandar la contraseña de vuelta al navegador).
function aClienteFrontend(fila) {
  return {
    email: fila.email,
    nombre: fila.nombre,
    telefono: fila.telefono || '',
    codigoPlanta: fila.codigo_planta || null,
    visita: fila.visita,
    fechaVisita: fila.fecha_visita,
    fechaRegistro: fila.fecha_registro,
    imagenes: fila.imagenes || []
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

  const { accion } = req.body || {};

  try {
    // ── REGISTRO ──────────────────────────────────────────
    if (accion === 'registro') {
      const { email, password, nombre, telefono } = req.body;
      if (!email || !password || !nombre) {
        return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios.' });
      }
      const { data: existente } = await supabase.from('clientes').select('email').eq('email', email).maybeSingle();
      if (existente) {
        return res.status(409).json({ exito: false, error: 'Email ya registrado.' });
      }
      const { error } = await supabase.from('clientes').insert([{
        email, password, nombre, telefono: telefono || ''
      }]);
      if (error) return res.status(400).json({ exito: false, error: error.message });
      return res.status(200).json({ exito: true });
    }

    // ── LOGIN ──────────────────────────────────────────────
    if (accion === 'login') {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ exito: false, error: 'Faltan campos.' });
      }
      const { data, error } = await supabase.from('clientes').select('*').eq('email', email).maybeSingle();
      if (error) return res.status(400).json({ exito: false, error: error.message });
      if (!data || data.password !== password) {
        return res.status(401).json({ exito: false, error: 'Credenciales inválidas.' });
      }
      return res.status(200).json({ exito: true, cliente: aClienteFrontend(data) });
    }

    // ── ACTUALIZAR (admin o el propio cliente) ──────────────
    if (accion === 'actualizar') {
      const { email, datos } = req.body;
      if (!email || !datos) {
        return res.status(400).json({ exito: false, error: 'Faltan campos.' });
      }
      const patch = {};
      if ('nombre' in datos) patch.nombre = datos.nombre;
      if ('telefono' in datos) patch.telefono = datos.telefono;
      if ('codigoPlanta' in datos) patch.codigo_planta = datos.codigoPlanta;
      if ('visita' in datos) patch.visita = datos.visita;
      if ('fechaVisita' in datos) patch.fecha_visita = datos.fechaVisita;
      if ('imagenes' in datos) patch.imagenes = datos.imagenes;
      if ('password' in datos) patch.password = datos.password;

      const { error } = await supabase.from('clientes').update(patch).eq('email', email);
      if (error) return res.status(400).json({ exito: false, error: error.message });
      return res.status(200).json({ exito: true });
    }

    // ── LISTAR (para el panel admin, sin contraseñas) ───────
    if (accion === 'listar') {
      const { data, error } = await supabase.from('clientes').select('*').order('fecha_registro', { ascending: false });
      if (error) return res.status(400).json({ exito: false, error: error.message });
      return res.status(200).json({ exito: true, clientes: (data || []).map(aClienteFrontend) });
    }

    return res.status(400).json({ exito: false, error: 'Acción no reconocida.' });
  } catch (error) {
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}
