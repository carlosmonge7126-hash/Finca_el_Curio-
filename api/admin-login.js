import bcrypt from 'bcryptjs';
import { crearTokenAdmin } from './_lib/adminAuth.js';
import { obtenerIp, permitir, responderDemasiados, igualesSeguro, exigirJson } from './_lib/seguridad.js';

// ═══════════════════════════════════════════════════════════════════════
//  ⚙️  CONFIGURACIÓN DEL ADMIN — AQUÍ ES DONDE SE MODIFICA
// ═══════════════════════════════════════════════════════════════════════
//  NOTA 1 — CORREO PERMITIDO:
//    Es el ÚNICO correo que puede entrar como administrador.
//    ⚠️ Pediste "carlos8995@ive.com", pero en tu proyecto (pie de página y
//    configuración) el correo es "carlos8995@live.com" (con L). Dejé "live.com"
//    para que no te quedes sin acceso. Si de verdad es "ive.com", cambia SOLO
//    esta línea y vuelve a subir el archivo a GitHub.
const EMAIL_ADMIN_PERMITIDO = 'carlos8995@live.com';
//
//  NOTA 2 — LÍMITE DE INTENTOS Y TIEMPO DE ESPERA (se aplica en el servidor):
//    MAX_INTENTOS    = intentos permitidos (3)
//    ESPERA_SEGUNDOS = tiempo para volver a intentar: 300 s = 5 minutos
//    Si cambias estos valores, cambia también ADMIN_MAX_INTENTOS y
//    ADMIN_ESPERA_MIN en index.html (esos solo afectan los mensajes visuales).
const MAX_INTENTOS = 3;
const ESPERA_SEGUNDOS = 300;
//
//  NOTA 3 — VARIABLES DE VERCEL (NO se tocan, se mantienen igual):
//    ADMIN_PASSWORD_HASH  → hash de la contraseña (se mantiene)
//    ADMIN_SESSION_SECRET → firma de la sesión (se mantiene)
//    ADMIN_EMAIL          → ya no se usa para validar; puedes dejarla o borrarla
// ═══════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }
  if (!exigirJson(req, res)) return;

  const ip = obtenerIp(req);
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || email.length > 254 || password.length > 200) {
    return res.status(400).json({ exito: false, error: 'Faltan campos.' });
  }

  // Se limpian espacios, saltos de línea y comillas que a veces se cuelan al pegar en Vercel
  const limpiarVar = (v) => String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();
  const adminHash = limpiarVar(process.env.ADMIN_PASSWORD_HASH);

  const emailOk = igualesSeguro(email.trim().toLowerCase(), EMAIL_ADMIN_PERMITIDO.trim().toLowerCase());

  // Cualquier otro correo (por ejemplo un cliente con la contraseña mal) NO puede ser admin:
  // se rechaza sin gastar los intentos del admin ni ejecutar bcrypt.
  if (!emailOk) {
    if (!(await permitir('admin-login-otro', ip, 60, ESPERA_SEGUNDOS, res))) return responderDemasiados(res);
    return res.status(401).json({ exito: false, error: 'Credenciales incorrectas' });
  }

  // Correo del admin: máximo MAX_INTENTOS por IP cada ESPERA_SEGUNDOS (+ freno global de 200/hora contra ataques con muchas IPs)
  if (!(await permitir('admin-login-ip', ip, MAX_INTENTOS, ESPERA_SEGUNDOS, res)) || !(await permitir('admin-login-global', 'todos', 200, 3600, res))) {
    return responderDemasiados(res);
  }

  if (!adminHash || !process.env.ADMIN_SESSION_SECRET) {
    console.error('❌ Faltan ADMIN_PASSWORD_HASH / ADMIN_SESSION_SECRET en Vercel');
    return res.status(500).json({ exito: false, error: 'El acceso de administrador no está configurado.' });
  }
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(adminHash)) {
    console.error(`❌ ADMIN_PASSWORD_HASH no tiene formato bcrypt válido (largo ${adminHash.length}; debe medir 60 y empezar con $2a$ o $2b$). Genera uno nuevo con generar-hash.cjs y pégalo sin comillas ni espacios.`);
    return res.status(500).json({ exito: false, error: 'El acceso de administrador no está configurado.' });
  }

  try {
    const passOk = await bcrypt.compare(password, adminHash);
    if (passOk) {
      const token = crearTokenAdmin();
      return res.status(200).json({ exito: true, token });
    }
    // Solo queda en los logs de Vercel (nunca se le dice al navegador qué falló)
    console.warn(`⚠️ Login de admin fallido desde ${ip}: contraseña NO coincide con ADMIN_PASSWORD_HASH`);
    return res.status(401).json({ exito: false, error: 'Credenciales incorrectas' });
  } catch (error) {
    console.error('❌ admin-login:', error?.message);
    return res.status(500).json({ exito: false, error: 'Error interno del servidor.' });
  }
}
