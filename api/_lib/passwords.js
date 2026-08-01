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
  return Buffer.from(passwordPlano, 'utf8').toString('base64') === valorGuardado;
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

export function crearTokenRecuperacion(email, codigo, minutos = 15) {
  if (!SECRET) return null;
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + minutos * 60 * 1000 })).toString('base64url');
  return `${payload}.${firmar(`${payload}:${codigo}`)}`;
}

// Devuelve el email si el token+código son válidos y no vencieron, o null.
export function verificarTokenRecuperacion(token, codigo) {
  if (!SECRET || !token || !codigo || !token.includes('.')) return null;
  const [payload, firma] = token.split('.');
  const firmaEsperada = firmar(`${payload}:${codigo}`);
  const bufA = Buffer.from(firma || '');
  const bufB = Buffer.from(firmaEsperada);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return null;
  try {
    const datos = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof datos.exp !== 'number' || datos.exp < Date.now()) return null;
    return datos.email;
  } catch {
    return null;
  }
}
