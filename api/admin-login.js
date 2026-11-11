import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { crearTokenAdmin } from './_lib/adminAuth.js';

// ═══════════════════════════════════════════════════════════
// Verifica el email/contraseña de admin del lado del servidor.
// El email y el hash de la contraseña viven SOLO en variables de
// entorno de Vercel (ADMIN_EMAIL / ADMIN_PASSWORD_HASH) — nunca en
// el HTML/JS que se manda al navegador. Así, aunque alguien vea el
// código fuente del sitio, no puede leer ni deducir la contraseña.
//
// Cómo generar ADMIN_PASSWORD_HASH (una sola vez, desde tu compu):
//   node -e "console.log(require('bcryptjs').hashSync('TU_CLAVE_NUEVA', 10))"
// Copiá el resultado ($2a$10$....) y pegalo como ADMIN_PASSWORD_HASH
// en Vercel → Settings → Environment Variables. ADMIN_EMAIL va tal
// cual (texto plano, no es secreto por sí solo). También hace falta
// ADMIN_SESSION_SECRET: cualquier texto largo al azar (ej. 40+
// caracteres) que sirve para firmar la sesión de admin — no tiene
// que ver con la contraseña, es solo una clave interna del servidor.
// ═══════════════════════════════════════════════════════════
// Si el admin recuperó su contraseña con "Olvidé mi contraseña", la clave
// nueva queda guardada (hash bcrypt) en una fila privada de "clientes"
// con el email del admin (ver api/clientes.js). Si existe, MANDA sobre
// ADMIN_PASSWORD_HASH; si no existe (o no se puede consultar), se usa la
// variable de entorno como siempre.
async function hashAdminVigente(adminEmail, hashEntorno) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return hashEntorno;
  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from('clientes').select('password')
      .eq('email', adminEmail.trim().toLowerCase()).maybeSingle();
    if (error) {
      console.warn('⚠️ No se pudo consultar la clave de admin en Supabase:', error.message);
      return hashEntorno;
    }
    if (data && typeof data.password === 'string' && /^\$2[aby]\$/.test(data.password)) {
      return data.password;
    }
  } catch (err) {
    console.warn('⚠️ Error consultando la clave de admin en Supabase:', err.message);
  }
  return hashEntorno;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

  const { email, password } = req.body || {};
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminHash = process.env.ADMIN_PASSWORD_HASH;

  if (!adminEmail || !adminHash) {
    return res.status(500).json({ exito: false, error: 'Falta configurar ADMIN_EMAIL / ADMIN_PASSWORD_HASH en el servidor.' });
  }
  if (!email || !password) {
    return res.status(400).json({ exito: false, error: 'Faltan campos.' });
  }

  try {
    const emailOk = email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
    // Solo se consulta la clave guardada si el correo coincide.
    const hashVigente = emailOk ? await hashAdminVigente(adminEmail, adminHash) : adminHash;
    const passOk = await bcrypt.compare(password, hashVigente);
    if (emailOk && passOk) {
      const token = crearTokenAdmin();
      if (!token) {
        return res.status(500).json({ exito: false, error: 'Falta configurar ADMIN_SESSION_SECRET en el servidor.' });
      }
      return res.status(200).json({ exito: true, token });
    }
    return res.status(401).json({ exito: false, error: 'Credenciales incorrectas' });
  } catch (error) {
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}
