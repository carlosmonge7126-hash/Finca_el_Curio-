import bcrypt from 'bcryptjs';
import { crearTokenAdmin } from './_lib/adminAuth.js';
import { obtenerIp, permitir, responderDemasiados, igualesSeguro, exigirJson } from './_lib/seguridad.js';

// ═══════════════════════════════════════════════════════════
// Verifica el email/contraseña de admin del lado del servidor.
// El email y el hash de la contraseña viven SOLO en variables de
// entorno de Vercel (ADMIN_EMAIL / ADMIN_PASSWORD_HASH) — nunca en
// el HTML/JS que se manda al navegador.
//
// Cómo generar ADMIN_PASSWORD_HASH (una sola vez, desde tu compu):
//   node -e "console.log(require('bcryptjs').hashSync('TU_CLAVE_NUEVA', 12))"
// ADMIN_SESSION_SECRET: texto largo al azar (mínimo 40 caracteres)
// que sirve para firmar la sesión de admin.
//
// Protección contra fuerza bruta: el límite se aplica AQUÍ, en el
// servidor (antes solo existía un contador en el navegador, que
// cualquiera se salta llamando directo a la API).
// ═══════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }
  if (!exigirJson(req, res)) return;

  const ip = obtenerIp(req);
  // 8 intentos por IP cada 15 min y 200 en total por hora (freno de emergencia contra ataques con muchas IPs)
  if (!(await permitir('admin-login-ip', ip, 8, 900, res)) || !(await permitir('admin-login-global', 'todos', 200, 3600, res))) {
    return responderDemasiados(res);
  }

  const { email, password } = req.body || {};
  // Se limpian espacios, saltos de línea y comillas que a veces se cuelan al pegar en Vercel
  const limpiarVar = (v) => String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();
  const adminEmail = limpiarVar(process.env.ADMIN_EMAIL);
  const adminHash = limpiarVar(process.env.ADMIN_PASSWORD_HASH);

  if (!adminEmail || !adminHash || !process.env.ADMIN_SESSION_SECRET) {
    console.error('❌ Faltan ADMIN_EMAIL / ADMIN_PASSWORD_HASH / ADMIN_SESSION_SECRET en Vercel');
    return res.status(500).json({ exito: false, error: 'El acceso de administrador no está configurado.' });
  }
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(adminHash)) {
    console.error(`❌ ADMIN_PASSWORD_HASH no tiene formato bcrypt válido (largo ${adminHash.length}; debe medir 60 y empezar con $2a$ o $2b$). Genera uno nuevo con scripts/generar-hash.cjs y pégalo sin comillas ni espacios.`);
    return res.status(500).json({ exito: false, error: 'El acceso de administrador no está configurado.' });
  }
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || email.length > 254 || password.length > 200) {
    return res.status(400).json({ exito: false, error: 'Faltan campos.' });
  }

  try {
    // Siempre se hace la comparación de bcrypt (aunque el email sea incorrecto)
    // para que el tiempo de respuesta no delate si el email existe.
    const passOk = await bcrypt.compare(password, adminHash);
    const emailOk = igualesSeguro(email.trim().toLowerCase(), adminEmail.trim().toLowerCase());
    if (emailOk && passOk) {
      const token = crearTokenAdmin();
      return res.status(200).json({ exito: true, token });
    }
    // Solo queda en los logs de Vercel (nunca se le dice al navegador cuál de los dos falló)
    console.warn(`⚠️ Login de admin fallido desde ${ip}: correo ${emailOk ? 'OK' : 'NO coincide con ADMIN_EMAIL'}, contraseña ${passOk ? 'OK' : 'NO coincide con ADMIN_PASSWORD_HASH'}`);
    return res.status(401).json({ exito: false, error: 'Credenciales incorrectas' });
  } catch (error) {
    console.error('❌ admin-login:', error?.message);
    return res.status(500).json({ exito: false, error: 'Error interno del servidor.' });
  }
}
