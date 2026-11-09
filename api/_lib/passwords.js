import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════
// Hash real de contraseñas de clientes (antes se guardaban con
// btoa(), que es solo texto en base64 y se revierte con atob() —
// no protege nada si alguien accede a la base de datos).
// ═══════════════════════════════════════════════════════════
export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// Compara una contraseña en texto plano contra lo que haya guardado
// en la fila. Soporta las filas viejas guardadas en base64 (btoa) de
// antes de este cambio: si el valor guardado no tiene pinta de hash
// de bcrypt, lo compara al estilo viejo. Así ninguna cuenta existente
// se queda sin poder entrar mientras se migra sola al hacer login
// (ver clientes.js).
export async function verificarPassword(passwordPlano, valorGuardado) {
  if (!valorGuardado || !passwordPlano) return false;
  if (/^\$2[aby]\$/.test(valorGuardado)) {
    return bcrypt.compare(passwordPlano, valorGuardado);
  }
  const esperado = Buffer.from(passwordPlano, 'utf8').toString('base64');
  const a = Buffer.from(esperado), b = Buffer.from(String(valorGuardado));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ═══════════════════════════════════════════════════════════
// Regla de contraseña segura para clientes: mínimo 8 caracteres,
// al menos una mayúscula, una minúscula y un carácter especial.
// El formulario del navegador ya la verifica, pero acá se vuelve a
// exigir para que no se pueda saltar llamando directo a la API.
// ═══════════════════════════════════════════════════════════
export const MENSAJE_PASSWORD_SEGURA =
  'La contraseña debe tener entre 8 y 72 caracteres, una mayúscula, una minúscula y un carácter especial.';

export function validarPasswordSegura(password) {
  if (typeof password !== 'string') return false;
  return password.length >= 8
    && Buffer.byteLength(password, 'utf8') <= 72
    && /\p{Lu}/u.test(password)
    && /\p{Ll}/u.test(password)
    && /[^\p{L}\p{N}\s]/u.test(password);
}

export function esHashBcrypt(valor) {
  return typeof valor === 'string' && /^\$2[aby]\$/.test(valor);
}

// ═══════════════════════════════════════════════════════════
// Recuperación de contraseña con código de un solo uso, SIN guardar
// nada en la base de datos: el propio token que se manda al navegador
// trae la fecha de vencimiento, y su firma HMAC compromete al código
// de 6 dígitos que se manda por correo (pero no lo contiene, así que
// nadie puede sacar el código mirando el token). Solo alguien que
// reciba el correo real puede completar el cambio de contraseña.
// ═══════════════════════════════════════════════════════════
const SECRET = process.env.RESET_SECRET;

function firmar(valor) {
  return crypto.createHmac('sha256', SECRET).update(valor).digest('base64url');
}

export function generarCodigoRecuperacion() {
  return String(crypto.randomInt(100000, 1000000)); // 6 dígitos
}

// "Huella" de la contraseña actual: no revela el hash, pero cambia en cuanto
// la contraseña cambia. Así un token ya usado (o robado) deja de servir.
export function huellaPassword(valorGuardado) {
  return crypto.createHash('sha256').update(String(valorGuardado || '')).digest('hex').slice(0, 24);
}

export function crearTokenRecuperacion(email, codigo, huella = '', minutos = 15) {
  if (!SECRET) return null;
  const payload = Buffer.from(JSON.stringify({ email, h: huella, exp: Date.now() + minutos * 60 * 1000 })).toString('base64url');
  return `${payload}.${firmar(`${payload}:${codigo}`)}`;
}

// Devuelve { email, huella } si el token+código son válidos y no vencieron, o null.
export function verificarTokenRecuperacion(token, codigo) {
  if (!SECRET || !token || !codigo || typeof token !== 'string' || token.length > 800) return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const [payload, firma] = partes;
  const firmaEsperada = firmar(`${payload}:${String(codigo)}`);
  const bufA = Buffer.from(firma || '');
  const bufB = Buffer.from(firmaEsperada);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return null;
  try {
    const datos = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof datos.exp !== 'number' || datos.exp < Date.now() || typeof datos.email !== 'string') return null;
    return { email: datos.email, huella: datos.h || '' };
  } catch {
    return null;
  }
}
