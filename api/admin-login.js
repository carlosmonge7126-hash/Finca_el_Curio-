import bcrypt from 'bcryptjs';

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
// cual (texto plano, no es secreto por sí solo).
// ═══════════════════════════════════════════════════════════
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
    const passOk = await bcrypt.compare(password, adminHash);
    if (emailOk && passOk) {
      return res.status(200).json({ exito: true });
    }
    return res.status(401).json({ exito: false, error: 'Credenciales incorrectas' });
  } catch (error) {
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}
