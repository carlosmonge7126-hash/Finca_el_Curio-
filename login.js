import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { email, password } = req.body;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    return res.status(200).json({ exito: true, usuario: data.user, sesion: data.session });
  } catch (error) {
    return res.status(401).json({ exito: false, mensaje: 'Credenciales inválidas.', error: error.message });
  }
}
