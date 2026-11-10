import { createClient } from '@supabase/supabase-js';
import { exigirAdmin, esPeticionAdmin } from './_lib/adminAuth.js';
import {
  hashPassword, verificarPassword, esHashBcrypt,
  validarPasswordSegura, MENSAJE_PASSWORD_SEGURA,
  generarCodigoRecuperacion, crearTokenRecuperacion, verificarTokenRecuperacion, huellaPassword
} from './_lib/passwords.js';
import {
  obtenerIp, permitir, responderDemasiados, limpiarTexto, limpiarTelefono,
  esEmailValido, exigirJson, errorBD, errorInterno, igualesSeguro
} from './_lib/seguridad.js';
import { transporter, credencialesCorreoListas, obtenerBaseUrl, plantillaRecuperacion, adjuntoLogo } from './_lib/correo.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

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

  if (!exigirJson(req, res)) return;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const { accion } = body;
  const ip = obtenerIp(req);
  // Tope general por IP: frena cualquier abuso masivo de este endpoint
  if (!(await permitir('clientes-ip', ip, 120, 900, res))) return responderDemasiados(res);
  // El correo del admin es EXCLUSIVO del admin: no puede entrar ni registrarse como cliente
  // (aunque exista una cuenta de cliente con ese correo). Así el login lo manda al acceso de admin.
  const correoAdmin = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const esCorreoAdmin = (e) => !!correoAdmin && igualesSeguro(String(e || '').trim().toLowerCase(), correoAdmin);
  // El email siempre se recorta; nunca se usa sin validar su formato
  const emailNorm = typeof body.email === 'string' ? body.email.trim() : '';

  try {
    // ── REGISTRO ──────────────────────────────────────────
    if (accion === 'registro') {
      const { password } = body;
      const email = emailNorm;
      const nombre = limpiarTexto(body.nombre, 80);
      const telefono = limpiarTelefono(body.telefono);
      if (!email || !password || !nombre) {
        return res.status(400).json({ exito: false, error: 'Faltan campos obligatorios.' });
      }
      if (!esEmailValido(email)) {
        return res.status(400).json({ exito: false, error: 'El correo no es válido.' });
      }
      if (!(await permitir('registro-ip', ip, 10, 3600, res))) return responderDemasiados(res);
      if (!validarPasswordSegura(password)) {
        return res.status(400).json({ exito: false, error: MENSAJE_PASSWORD_SEGURA, motivo: 'password_debil' });
      }
      const { data: existente } = await supabase.from('clientes').select('email').eq('email', email).maybeSingle();
      if (existente || esCorreoAdmin(email)) {
        return res.status(409).json({ exito: false, error: 'Email ya registrado.' });
      }
      const passwordHash = await hashPassword(password);
      const { error } = await supabase.from('clientes').insert([{
        email, password: passwordHash, nombre, telefono: telefono || ''
      }]);
      if (error) return errorBD(res, error, 'clientes.registro');
      return res.status(200).json({ exito: true });
    }

    // ── LOGIN ──────────────────────────────────────────────
    if (accion === 'login') {
      const { password } = body;
      const email = emailNorm;
      if (!email || typeof password !== 'string' || !password || password.length > 200) {
        return res.status(400).json({ exito: false, error: 'Faltan campos.' });
      }
      // 12 intentos por cuenta cada 15 min (frena adivinar contraseñas) y 40 por IP
      if (!(await permitir('login-email', email.toLowerCase(), 12, 900, res)) || !(await permitir('login-ip', ip, 40, 900, res))) {
        return responderDemasiados(res);
      }
      if (esCorreoAdmin(email)) {
        // Misma respuesta que una contraseña incorrecta: no revela que es el correo del admin
        return res.status(401).json({ exito: false, error: 'Credenciales inválidas.' });
      }
      const { data, error } = await supabase.from('clientes').select('*').eq('email', email).maybeSingle();
      if (error) return errorBD(res, error, 'clientes.login');
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
      // La planta del cliente (foto, comentarios, avances) viaja SOLO con su
      // propio login: ya no se publica en una tabla legible por cualquiera.
      let planta = null;
      if (data.codigo_planta) {
        const { data: pl } = await supabase.from('plantas')
          .select('codigo, imagen, comentario, fecha_asignacion, historial_comentarios')
          .eq('codigo', data.codigo_planta).eq('cliente_email', data.email).maybeSingle();
        if (pl) {
          planta = {
            codigo: pl.codigo, imagen: pl.imagen, comentario: pl.comentario || '',
            fechaAsignacion: pl.fecha_asignacion, historialComentarios: pl.historial_comentarios || []
          };
        }
      }
      return res.status(200).json({ exito: true, cliente: aClienteFrontend(data), planta });
    }

    // ── ACTUALIZAR (admin, o el propio cliente demostrando su contraseña) ──
    if (accion === 'actualizar') {
      const { datos, password } = body;
      const email = emailNorm;
      if (!email || !datos || typeof datos !== 'object' || Array.isArray(datos)) {
        return res.status(400).json({ exito: false, error: 'Faltan campos.' });
      }

      const esAdmin = esPeticionAdmin(req);

      if (!esAdmin) {
        if (!(await permitir('actualizar-email', email.toLowerCase(), 15, 900, res))) return responderDemasiados(res);
        const { data: fila, error: errFila } = await supabase.from('clientes').select('password').eq('email', email).maybeSingle();
        if (errFila) return errorBD(res, errFila, 'clientes.actualizar.consulta');
        if (!fila || !(await verificarPassword(password, fila.password))) {
          return res.status(401).json({ exito: false, error: 'No autorizado.' });
        }
        // Aunque el cliente mande estos campos (p. ej. porque el
        // panel reutiliza el mismo objeto de datos), se ignoran si
        // no viene con un token de admin válido.
        for (const campo of CAMPOS_SOLO_ADMIN) delete datos[campo];
      }

      if ('password' in datos && datos.password && (typeof datos.password !== 'string' || !validarPasswordSegura(datos.password))) {
        return res.status(400).json({ exito: false, error: MENSAJE_PASSWORD_SEGURA, motivo: 'password_debil' });
      }

      const patch = {};
      if ('nombre' in datos) {
        const n = limpiarTexto(datos.nombre, 80);
        if (!n) return res.status(400).json({ exito: false, error: 'El nombre no puede quedar vacío.' });
        patch.nombre = n;
      }
      if ('telefono' in datos) patch.telefono = limpiarTelefono(datos.telefono);
      if ('codigoPlanta' in datos) patch.codigo_planta = datos.codigoPlanta === null ? null : limpiarTexto(datos.codigoPlanta, 20);
      if ('visita' in datos) patch.visita = (typeof datos.visita === 'boolean' || datos.visita === null) ? datos.visita : limpiarTexto(datos.visita, 40);
      if ('fechaVisita' in datos) patch.fecha_visita = datos.fechaVisita === null ? null : limpiarTexto(datos.fechaVisita, 40);
      if ('imagenes' in datos) {
        if (!Array.isArray(datos.imagenes) || datos.imagenes.length > 200
            || datos.imagenes.some(u => typeof u !== 'string' || u.length > 1000)) {
          return res.status(400).json({ exito: false, error: 'Lista de imágenes no válida.' });
        }
        patch.imagenes = datos.imagenes;
      }
      if ('eliminado' in datos) patch.eliminado = !!datos.eliminado;
      if ('password' in datos && datos.password) patch.password = await hashPassword(datos.password);

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ exito: false, error: 'Nada para actualizar.' });
      }

      const { error } = await supabase.from('clientes').update(patch).eq('email', email);
      if (error) return errorBD(res, error, 'clientes.actualizar');
      return res.status(200).json({ exito: true });
    }

    // ── LISTAR (para el panel admin, sin contraseñas) — solo admin ──
    if (accion === 'listar') {
      if (!exigirAdmin(req, res)) return;
      const { data, error } = await supabase.from('clientes').select('*').order('fecha_registro', { ascending: false });
      if (error) return errorBD(res, error, 'clientes.listar');
      return res.status(200).json({ exito: true, clientes: (data || []).map(aClienteFrontend) });
    }

    // ── LIMPIAR ELIMINADOS (borrado permanente) — solo admin ──
    if (accion === 'limpiar_eliminados') {
      if (!exigirAdmin(req, res)) return;
      const { emails } = body;
      let query = supabase.from('clientes').delete().eq('eliminado', true);
      if (Array.isArray(emails) && emails.length) {
        if (emails.length > 500 || emails.some(e => typeof e !== 'string')) {
          return res.status(400).json({ exito: false, error: 'Lista de correos no válida.' });
        }
        query = query.in('email', emails);
      }
      const { error } = await query;
      if (error) return errorBD(res, error, 'clientes.limpiar');
      return res.status(200).json({ exito: true });
    }

    // ── SOLICITAR RECUPERACIÓN (paso 1: pide el código por correo) ──
    if (accion === 'solicitar_recuperacion') {
      const email = emailNorm;
      if (!email) return res.status(400).json({ exito: false, error: 'Falta el correo.' });
      if (!esEmailValido(email)) return res.status(400).json({ exito: false, error: 'El correo no es válido.' });
      // Máximo 3 correos por cuenta por hora y 10 por IP: evita que el sitio
      // se use para inundar de correos a alguien (y proteger la cuota de Gmail).
      if (!(await permitir('recuperar-email', email.toLowerCase(), 3, 3600, res)) || !(await permitir('recuperar-ip', ip, 10, 3600, res))) {
        return responderDemasiados(res);
      }
      if (!credencialesCorreoListas()) {
        console.error('❌ Faltan GMAIL_USER / GMAIL_APP_PASSWORD');
        return res.status(500).json({ exito: false, error: 'El envío de correos no está configurado.' });
      }
      const codigo = generarCodigoRecuperacion();
      const { data: fila } = await supabase.from('clientes').select('email, password').eq('email', email).maybeSingle();

      if (!fila) {
        // La cuenta no existe: se responde IGUAL que si existiera (con un token
        // que nunca va a validar) para no revelar qué correos están registrados.
        const falso = crearTokenRecuperacion(email, generarCodigoRecuperacion(), 'x');
        if (!falso) return res.status(500).json({ exito: false, error: 'La recuperación de contraseña no está configurada.' });
        return res.status(200).json({ exito: true, token: falso });
      }
      const token = crearTokenRecuperacion(email, codigo, huellaPassword(fila.password));
      if (!token) {
        console.error('❌ Falta RESET_SECRET');
        return res.status(500).json({ exito: false, error: 'La recuperación de contraseña no está configurada.' });
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
      const { token, codigo, nuevaPassword } = body;
      if (!token || !codigo || !nuevaPassword || typeof nuevaPassword !== 'string') {
        return res.status(400).json({ exito: false, error: 'Faltan campos.' });
      }
      // El código tiene 6 dígitos (1.000.000 de combinaciones): sin este tope
      // se podía adivinar probando uno por uno. Máximo 5 intentos por token.
      const huellaToken = String(token).slice(-24);
      if (!(await permitir('recuperar-confirmar', huellaToken, 5, 900, res)) || !(await permitir('recuperar-confirmar-ip', ip, 20, 900, res))) {
        return responderDemasiados(res);
      }
      const verificado = verificarTokenRecuperacion(token, String(codigo).trim());
      if (!verificado) {
        return res.status(401).json({ exito: false, error: 'Código incorrecto o vencido.' });
      }
      const { email, huella } = verificado;
      // El token solo sirve mientras la contraseña siga siendo la misma que
      // cuando se pidió: una vez usado (o si ya la cambiaste), queda inválido.
      const { data: fila, error: errFila } = await supabase.from('clientes').select('password').eq('email', email).maybeSingle();
      if (errFila) return errorBD(res, errFila, 'clientes.confirmar.consulta');
      if (!fila || huellaPassword(fila.password) !== huella) {
        return res.status(401).json({ exito: false, error: 'Código incorrecto o vencido.' });
      }
      if (!validarPasswordSegura(nuevaPassword)) {
        return res.status(400).json({ exito: false, error: MENSAJE_PASSWORD_SEGURA, motivo: 'password_debil' });
      }
      const nuevoHash = await hashPassword(nuevaPassword);
      const { error } = await supabase.from('clientes').update({ password: nuevoHash }).eq('email', email);
      if (error) return errorBD(res, error, 'clientes.confirmar');
      return res.status(200).json({ exito: true, email });
    }

    return res.status(400).json({ exito: false, error: 'Acción no reconocida.' });
  } catch (error) {
    return errorInterno(res, error, 'clientes');
  }
}
