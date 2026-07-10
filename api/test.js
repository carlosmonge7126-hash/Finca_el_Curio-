import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  const { data, error } = await supabase.from('reservas').select('*').limit(1);
  if (error) {
    return res.status(500).json({ conectado: false, error: error.message });
  }
  return res.status(200).json({ conectado: true, mensaje: '✅ Conexión exitosa a Supabase', version: "1.0.0", datos: data });
}
