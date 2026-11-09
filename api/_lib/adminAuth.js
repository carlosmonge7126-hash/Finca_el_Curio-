import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════
// Token de sesión de admin: se emite en /api/admin-login después
// de validar el email/contraseña contra las variables de entorno,
// y se exige en los endpoints "sensibles" vía el header
// "x-admin-token". No se guarda nada en la base de datos: el propio
// token trae la fecha de expiración y una firma HMAC que solo el
// servidor puede generar (con ADMIN_SESSION_SECRET).
// ═══════════════════════════════════════════════════════════

const SECRET = process.env.ADMIN_SESSION_SECRET;

function firmar(valor) {
  return crypto.createHmac('sha256', SECRET).update(valor).digest('base64url');
}

export function crearTokenAdmin(minutos = 30) {
  if (!SECRET) return null;
  const ahora = Date.now();
  const payload = Buffer.from(JSON.stringify({
    rol: 'admin',
    iat: ahora,
    exp: ahora + minutos * 60 * 1000,
    jti: crypto.randomBytes(8).toString('hex')
  })).toString('base64url');
  return `${payload}.${firmar(payload)}`;
}

export function tokenAdminValido(token) {
  if (!SECRET || !token || typeof token !== 'string' || token.length > 600) return false;
  const partes = token.split('.');
  if (partes.length !== 2) return false;
  const [payload, firma] = partes;
  const bufA = Buffer.from(firma || '');
  const bufB = Buffer.from(firmar(payload));
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return false;
  try {
    const datos = JSON.parse(Buffer.from(payload, 'base64url').toString());
    // "rol" solo se exige si el token lo trae: así las sesiones abiertas
    // con el formato anterior siguen valiendo hasta que venzan.
    if (datos.rol !== undefined && datos.rol !== 'admin') return false;
    return typeof datos.exp === 'number' && datos.exp > Date.now();
  } catch {
    return false;
  }
}

export function esPeticionAdmin(req) {
  return tokenAdminValido(req.headers['x-admin-token']);
}

// Corta el request con 401 si no es admin. Devuelve true/false para
// que el endpoint sepa si debe seguir ejecutando el resto del código.
export function exigirAdmin(req, res) {
  if (!esPeticionAdmin(req)) {
    res.status(401).json({ exito: false, error: 'No autorizado.' });
    return false;
  }
  return true;
}
