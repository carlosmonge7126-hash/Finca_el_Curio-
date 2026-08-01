import { createClient } from '@supabase/supabase-js';
import { exigirAdmin, esPeticionAdmin } from './_lib/adminAuth.js';
import {
  hashPassword, verificarPassword, esHashBcrypt,
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
      const { data, error } = await supabase.from('clientes').select('*').order('fecha_registro', { ascending: false });
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
      if (!email) return res.status(400).json({ exito: false, error: 'Falta el correo.' });

      const { data: fila } = await supabase.from('clientes').select('email').eq('email', email).maybeSingle();
      // Respuesta genérica exista o no la cuenta, para no revelar
      // qué correos están registrados.
      if (!fila) {
        return res.status(200).json({ exito: true });
      }
      if (!credencialesCorreoListas()) {
        return res.status(500).json({ exito: false, error: 'Falta configurar GMAIL_USER / GMAIL_APP_PASSWORD en el servidor.' });
      }
      const codigo = generarCodigoRecuperacion();
      const token = crearTokenRecuperacion(email, codigo);
      if (!token) {
        return res.status(500).json({ exito: false, error: 'Falta configurar RESET_SECRET en el servidor.' });
      }
      const baseUrl = obtenerBaseUrl(req);
      await transporter.sendMail({
        from: `"Finca El Curio" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: '🔐 Código para recuperar tu contraseña — Finca El Curio',
        html: plantillaRecuperacion({ codigo, baseUrl }),
        attachments: [adjuntoLogo()]
      });
      return res.status(200).json({ exito: true, token });
    }

    // ── CONFIRMAR RECUPERACIÓN (paso 2: código + contraseña nueva) ──
    if (accion === 'confirmar_recuperacion') {
      const { token, codigo, nuevaPassword } = req.body;
      if (!token || !codigo || !nuevaPassword) {
        return res.status(400).json({ exito: false, error: 'Faltan campos.' });
      }
      const email = verificarTokenRecuperacion(token, codigo);
      if (!email) {
        return res.status(401).json({ exito: false, error: 'Código incorrecto o vencido.' });
      }
      const nuevoHash = await hashPassword(nuevaPassword);
      const { error } = await supabase.from('clientes').update({ password: nuevoHash }).eq('email', email);
      if (error) return res.status(400).json({ exito: false, error: error.message });
      return res.status(200).json({ exito: true, email });
    }

    return res.status(400).json({ exito: false, error: 'Acción no reconocida.' });
  } catch (error) {
    return res.status(500).json({ exito: false, error: error.message || 'Error interno del servidor' });
  }
}
