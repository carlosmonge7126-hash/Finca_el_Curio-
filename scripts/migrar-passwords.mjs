// ═══════════════════════════════════════════════════════════════════════
// Migra a bcrypt las contraseñas de clientes que quedaron en el formato
// viejo (base64, que cualquiera puede decodificar si se filtra la base).
// Solo hace falta correrlo UNA vez, desde tu computador (no se sube a Vercel
// como función: está en /scripts).
//
//   1) npm install
//   2) Ver qué cambiaría (no modifica nada):
//        SUPABASE_URL=https://TU-PROYECTO.supabase.co \
//        SUPABASE_SERVICE_ROLE_KEY=tu_service_role \
//        node scripts/migrar-passwords.mjs
//   3) Aplicar de verdad:
//        (mismas variables)  node scripts/migrar-passwords.mjs --aplicar
// ═══════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const aplicar = process.argv.includes('--aplicar');
if (!url || !key) { console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const supabase = createClient(url, key, { auth: { persistSession: false } });
const esBcrypt = (v) => typeof v === 'string' && /^\$2[aby]\$\d{2}\$/.test(v);

const { data, error } = await supabase.from('clientes').select('email, password');
if (error) { console.error('Error leyendo clientes:', error.message); process.exit(1); }

let pendientes = 0, migradas = 0, omitidas = 0;
for (const c of data) {
  if (!c.password || esBcrypt(c.password)) continue;
  pendientes++;
  const plano = Buffer.from(c.password, 'base64').toString('utf8');
  // Si al decodificar no vuelve a codificarse igual, no era base64 válido: se omite
  if (!plano || Buffer.from(plano, 'utf8').toString('base64') !== c.password) { omitidas++; console.log('⚠️ omitida (formato desconocido):', c.email); continue; }
  if (!aplicar) { console.log('→ se migraría:', c.email); continue; }
  const hash = await bcrypt.hash(plano, 10);
  const { error: e } = await supabase.from('clientes').update({ password: hash }).eq('email', c.email);
  if (e) console.error('❌', c.email, e.message); else migradas++;
}
console.log(`\nPendientes: ${pendientes} · Migradas: ${migradas} · Omitidas: ${omitidas}${aplicar ? '' : '  (simulación: usa --aplicar para guardar)'}`);

