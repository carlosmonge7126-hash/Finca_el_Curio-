import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { exigirAdmin, esPeticionAdmin } from './_lib/adminAuth.js';
import {
  hashPassword, verificarPassword, esHashBcrypt,
  validarPasswordSegura, MENSAJE_PASSWORD_SEGURA,
  generarCodigoRecuperacion, crearTokenRecuperacion, verificarTokenRecuperacion
} from './_lib/passwords.js';
import { transporter, credencialesCorreoListas, obtenerBaseUrl, plantillaRecuperacion, adjuntoLogo } from './_lib/correo.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Campos que solo el panel de admin puede tocar (requieren
// x-admin-token válido). Un cliente normal solo puede tocar su
// propio nombre/teléfono/contraseña demostrando que la conoce.
const CAMPOS_SOLO_ADMIN = ['codigoPlanta', 'visita', 'fechaVisita', 'imagenes', 'eliminado'];

// ═══════════════════════════════════════════════════════════
// ADMIN: el correo/contraseña del admin viven en variables de entorno
// (ADMIN_EMAIL / ADMIN_PASSWORD_HASH), no en la tabla "clientes".
// Por eso "Olvidé mi contraseña" antes no hacía nada con el correo del
// admin (no lo encontraba en la tabla y respondía "ok" sin enviar).
// Ahora, al recuperar la contraseña del admin, la nueva clave se guarda
// (con hash bcrypt) en una fila PRIVADA de "clientes" cuyo email es el
// del admin, y /api/admin-login la usa por encima de la variable de
// entorno. Esa fila no se lista en el panel ni se puede registrar/usar
// como cliente normal (ver las verificaciones esEmailAdmin más abajo).
// ═══════════════════════════════════════════════════════════
function emailAdminClave() {
  return (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
}
function esEmailAdmin(email) {
  const a = emailAdminClave();
  return !!a && typeof email === 'string' && email.trim().toLowerCase() === a;
}

// Envía el correo del código. Si falla con el logo adjunto (por ejemplo
// porque el archivo no quedó empaquetado en la función de Vercel), se
// reintenta sin adjunto para que el código SIEMPRE llegue.
async function enviarCorreoCodigo({ destino, codigo, baseUrl }) {
  const base = {
    from: `"Finca El Curio" <${process.env.GMAIL_USER}>`,
    to: destino,
    subject: '🔐 Código para recuperar tu contraseña — Finca El Curio',
    html: plantillaRecuperacion({ codigo, baseUrl })
  };
  try {
    await transporter.sendMail({ ...base, attachments: [adjuntoLogo()] });
  } catch (err1) {
    console.error('⚠️ Falló el envío con logo adjunto, reintentando sin adjunto:', err1.message);
    await transporter.sendMail(base);
  }
}

// Convierte una fila de la tabla a la forma que espera el frontend
// (y evita mandar la contraseña de vuelta al navegador).
function aClienteFrontend(fila) {
  return {
    email: fila.email,
    nombre: fila.nombre,
    telefono: fila.telefono || '',
    codigoPlanta: fila.codigo_planta || null,
    visita: fila.visita,
    fechaVisita: fila.fecha_visita,
    fechaRegistro: fila.fecha_registro,
    imagenes: fila.imagenes || [],
    eliminado: fila.eliminado || false
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ exito: false, error: 'Método no permitido' });
  }

  const { accion } = req.body || {};

  try {
    // ── REGISTRO ──────────────────────────────────────────
    if (accion === 'registro') {
      const { email, password, nombre, telefono } = req.body;
      if (!email || !password || !nombre) {
        return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios.' });
      }
      if (!validarPasswordSegura(password)) {
        return res.status(400).json({ exito: false, error: MENSAJE_PASSWORD_SEGURA, motivo: 'password_debil' });
      }
      // El correo del admin no se puede registrar como cliente.
      if (esEmailAdmin(email)) {
        return res.status(409).json({ exito: false, error: 'Email ya registrado.' });
      }
      const { data: existente } = await supabase.from('clientes').select('email').eq('email', email).maybeSingle();
      if (existente) {
        return res.status(409).json({ exito: false, error: 'Email ya registrado.' });
      }
      const passwordHash = await hashPassword(password);
      const { error } = await supabase.from('clientes').insert([{
        email, password: passwordHash, nombre, telefono: telefono || ''
      }]);
      if (error) return res.status(400).json({ exito: false, error: error.message });
      return res.status(200).json({ exito: true });
    }

    // ── LOGIN ──────────────────────────────────────────────
    if (accion === 'login') {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ exito: false, error: 'Faltan campos.' });
      }
      // El admin entra solo por /api/admin-login, nunca como cliente.
      if (esEmailAdmin(email)) {
        return res.status(401).json({ exito: false, error: 'Credenciales inválidas.' });
      }
      const { data, error } = await supabase.from('clientes').select('*').eq('email', email).maybeSingle();
      if (error) return res.status(400).json({ exito: false, error: error.message });
      const ok = data && await verificarPassword(password, data.password);
      if (!ok) {
        return res.status(401).json({ exito: false, error: 'Credenciales inválidas.' });
      }
      // Migración transparente: si la fila todavía tenía la contraseña
      // vieja en base64, la re-guardamos ya con hash real de una vez.
      if (!esHashBcrypt(data.password)) {
        const nuevoHash = await hashPassword(password);
        supabase.from('clientes').update({ password: nuevoHash }).eq('email', email)
          .then(({ error: errUpd }) => { if (errUpd) console.warn('⚠️ No se pudo migrar la contraseña a hash:', errUpd.message); });
      }
      return res.status(200).json({ exito: true, cliente: aClienteFrontend(data) });
    }

    // ── ACTUALIZAR (admin, o el propio cliente demostrando su contraseña) ──
    if (accion === 'actualizar') {
      const { email, datos, password } = req.body;
      if (!email || !datos) {
        return res.status(400).json({ exito: false, error: 'Faltan campos.' });
      }

      const esAdmin = esPeticionAdmin(req);

      if (!esAdmin && esEmailAdmin(email)) {
        return res.status(401).json({ exito: false, error: 'No autorizado.' });
      }

      if (!esAdmin) {
        const { data: fila, error: errFila } = await supabase.from('clientes').select('password').eq('email', email).maybeSingle();
        if (errFila) return res.status(400).json({ exito: false, error: errFila.message });
        if (!fila || !(await verificarPassword(password, fila.password))) {
          return res.status(401).json({ exito: false, error: 'No autorizado.' });
        }
        // Aunque el cliente mande estos campos (p. ej. porque el
        // panel reutiliza el mismo objeto de datos), se ignoran si
        // no viene con un token de admin válido.
        for (const campo of CAMPOS_SOLO_ADMIN) delete datos[campo];
      }

      if ('password' in datos && datos.password && !validarPasswordSegura(datos.password)) {
        return res.status(400).json({ exito: false, error: MENSAJE_PASSWORD_SEGURA, motivo: 'password_debil' });
      }

      const patch = {};
      if ('nombre' in datos) patch.nombre = datos.nombre;
      if ('telefono' in datos) patch.telefono = datos.telefono;
      if ('codigoPlanta' in datos) patch.codigo_planta = datos.codigoPlanta;
      if ('visita' in datos) patch.visita = datos.visita;
      if ('fechaVisita' in datos) patch.fecha_visita = datos.fechaVisita;
      if ('imagenes' in datos) patch.imagenes = datos.imagenes;
      if ('eliminado' in datos) patch.eliminado = !!datos.eliminado;
      if ('password' in datos && datos.password) patch.password = await hashPassword(datos.password);

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ exito: false, error: 'Nada para actualizar.' });
      }

      const { error } = await supabase.from('clientes').update(patch).eq('email', email);
      if (error) return res.status(400).json({ exito: false, error: error.message });
      return res.status(200).json({ exito: true });
    }

    // ── LISTAR (para el panel admin, sin contraseñas) — solo admin ──
    if (accion === 'listar') {
      if (!exigirAdmin(req, res)) return;
      let consulta = supabase.from('clientes').select('*').order('fecha_registro', { ascending: false });
      const claveAdmin = emailAdminClave();
      if (claveAdmin) consulta = consulta.neq('email', claveAdmin); // la fila interna del admin no es un cliente
      const { data, error } = await consulta;
      if (error) return res.status(400).json({ exito: false, error: error.message });
      return res.status(200).json({ exito: true, clientes: (data || []).map(aClienteFrontend) });
    }

    // ── LIMPIAR ELIMINADOS (borrado permanente) — solo admin ──
    if (accion === 'limpiar_eliminados') {
      if (!exigirAdmin(req, res)) return;
      const { emails } = req.body;
      let query = supabase.from('clientes').delete().eq('eliminado', true);
      if (Array.isArray(emails) && emails.length) {
        query = query.in('email', emails);
      }
      const { error } = await query;
      if (error) return res.status(400).json({ exito: false, error: error.message });
      return res.status(200).json({ exito: true });
    }

    // ── SOLICITAR RECUPERACIÓN (paso 1: pide el código por correo) ──
    if (accion === 'solicitar_recuperacion') {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ exito: false, error: 'Falta el correo.' });
      }
      const emailLimpio = email.trim();
      const esReinicioAdmin = esEmailAdmin(emailLimpio);

      // Correo al que se envía el código y correo que queda dentro del token.
      let destino = emailLimpio;
      let emailToken = emailLimpio;
      if (esReinicioAdmin) {
        destino = process.env.ADMIN_EMAIL.trim();
        emailToken = emailAdminClave();
      } else {
        const { data: fila } = await supabase.from('clientes').select('email').eq('email', emailLimpio).maybeSingle();
        // Respuesta genérica exista o no la cuenta, para no revelar
        // qué correos están registrados.
        if (!fila) {
          return res.status(200).json({ exito: true });
        }
      }

      if (!credencialesCorreoListas()) {
        console.error('❌ Falta GMAIL_USER / GMAIL_APP_PASSWORD en Vercel.');
        return res.status(500).json({ exito: false, error: 'Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD en el servidor.' });
      }

      // Admin: código de 8 dígitos (más difícil de adivinar, porque quien
      // lo adivine podría cambiar la clave del admin). Clientes: 6 dígitos,
      // como antes. En ambos casos vence en 15 minutos (lo que dice el correo).
      const minutos = 15;
      const codigo = esReinicioAdmin
        ? String(crypto.randomInt(10000000, 100000000))
        : generarCodigoRecuperacion();
      const token = crearTokenRecuperacion(emailToken, codigo, minutos);
      if (!token) {
        console.error('❌ Falta RESET_SECRET en Vercel.');
        return res.status(500).json({ exito: false, error: 'Falta configurar RESET_SECRET en el servidor.' });
      }
      const baseUrl = obtenerBaseUrl(req);
      try {
        await enviarCorreoCodigo({ destino, codigo, baseUrl });
      } catch (errMail) {
        console.error('❌ No se pudo enviar el correo de recuperación:', errMail.message);
        return res.status(500).json({ exito: false, error: 'No se pudo enviar el correo (revisa GMAIL_USER / GMAIL_APP_PASSWORD en Vercel).' });
      }
      return res.status(200).json({ exito: true, token });
    }

    // ── CONFIRMAR RECUPERACIÓN (paso 2: código + contraseña nueva) ──
    if (accion === 'confirmar_recuperacion') {
      const { token, nuevaPassword } = req.body;
      // El código puede venir con espacios o guiones (ej. "1234 5678").
      const codigo = String(req.body.codigo || '').replace(/[\s-]/g, '');
      if (!token || !codigo || !nuevaPassword) {
        return res.status(400).json({ exito: false, error: 'Faltan campos.' });
      }
      const email = verificarTokenRecuperacion(token, codigo);
      if (!email) {
        return res.status(401).json({ exito: false, error: 'Código incorrecto o vencido.' });
      }
      if (!validarPasswordSegura(nuevaPassword)) {
        return res.status(400).json({ exito: false, error: MENSAJE_PASSWORD_SEGURA, motivo: 'password_debil' });
      }
      const nuevoHash = await hashPassword(nuevaPassword);

      // ── Admin: la nueva clave se guarda en la fila interna del admin ──
      if (esEmailAdmin(email)) {
        const clave = emailAdminClave();
        const { data: existente, error: errSel } = await supabase.from('clientes').select('email').eq('email', clave).maybeSingle();
        if (errSel) return res.status(400).json({ exito: false, error: errSel.message });
        const { error: errGuardar } = existente
          ? await supabase.from('clientes').update({ password: nuevoHash }).eq('email', clave)
          : await supabase.from('clientes').insert([{ email: clave, password: nuevoHash, nombre: 'Administrador (sistema)', telefono: '' }]);
        if (errGuardar) return res.status(400).json({ exito: false, error: errGuardar.message });
        return res.status(200).json({ exito: true, email: clave });
      }

      const { error } = await supabase.from('clientes').update({ password: nuevoHash }).eq('email', email);
      if (error) return res.status(400).json({ exito: false, error: error.message });
      return res.status(200).json({ exito: true, email });
    }

    return res.status(400).json({ exito: false, error: 'Acción no reconocida.' });
  } catch (error) {
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}
