import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; 
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  // Capturamos los datos del formulario de registro de tu web
  const { email, password, nombre, telefono } = req.body;

  if (!email || !password) {
    return res.status(400).json({ exito: false, error: 'Correo y contraseña obligatorios.' });
  }

  try {
    // 1. Crear el usuario en el sistema de autenticación de Supabase
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        // Guardamos el nombre y teléfono dentro de los metadatos del usuario
        data: {
          full_name: nombre,
          phone_number: telefono
        }
      }
    });

    if (authError) throw authError;

    return res.status(200).json({ 
      exito: true, 
      mensaje: '¡Usuario registrado correctamente!', 
      usuario: authData.user 
    });

  } catch (error) {
    return res.status(500).json({ 
      exito: false, 
      mensaje: 'Hubo un error al crear la cuenta.', 
      error: error.message 
    });
  }
}
