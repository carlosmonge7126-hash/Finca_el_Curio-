import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════
// Token de sesión de admin: se emite en /api/admin-login después
// de validar el email/contraseña contra las variables de entorno,
// y se exige en el resto de los endpoints "sensibles" (borrar
// clientes, reasignar reservas, etc.) vía el header
// "x-admin-token". No se guarda nada en la base de datos: el
// propio token trae la fecha de expiración y una firma HMAC que
// solo el servidor puede generar (con ADMIN_SESSION_SECRET), así
// que no se puede falsificar sin conocer ese secreto.
// ═══════════════════════════════════════════════════════════

const SECRET = process.env.ADMIN_SESSION_SECRET;

function firmar(valor) {
  return crypto.createHmac('sha256', SECRET).update(valor).digest('base64url');
}

export function crearTokenAdmin(minutos = 30) {
  if (!SECRET) return null;
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + minutos * 60 * 1000 })).toString('base64url');
  return `${payload}.${firmar(payload)}`;
}

export function tokenAdminValido(token) {
  if (!SECRET || !token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, firma] = token.split('.');
  const firmaEsperada = firmar(payload);
  const bufA = Buffer.from(firma || '');
  const bufB = Buffer.from(firmaEsperada);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return false;
  try {
    const datos = JSON.parse(Buffer.from(payload, 'base64url').toString());
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
