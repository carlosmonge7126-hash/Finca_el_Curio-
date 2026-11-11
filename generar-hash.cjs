// Genera el valor para ADMIN_PASSWORD_HASH sin problemas de comillas ni símbolos raros.
// Uso (desde la carpeta del proyecto, después de "npm install"):
//     node scripts/generar-hash.cjs
// Te pide la contraseña, la escribes dos veces, comprueba que el hash sirve
// y te muestra la línea lista para copiar y pegar en Vercel.
const readline = require('readline');
const bcrypt = require('bcryptjs');

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const it = rl[Symbol.asyncIterator]();
  const preguntar = async (t) => { process.stdout.write(t); const { value } = await it.next(); return value === undefined ? '' : value; };

  console.log('\n⚠️  Al escribir la contraseña se verá en pantalla. Hazlo donde nadie mire.\n');
  const a = await preguntar('Contraseña nueva de admin: ');
  const b = await preguntar('Repítela: ');
  rl.close();
  if (!a || a !== b) { console.error('\n❌ No coinciden (o están vacías). Vuelve a correr el comando.'); process.exit(1); }
  if (a.length < 10) { console.error('\n❌ Usa al menos 10 caracteres.'); process.exit(1); }
  const hash = bcrypt.hashSync(a, 12);
  const prueba = bcrypt.compareSync(a, hash);
  console.log('\nVerificación del hash:', prueba ? '✅ correcta' : '❌ FALLÓ');
  console.log('Largo:', hash.length, '(debe ser 60)\n');
  console.log('Copia SOLO esta línea (sin comillas y sin espacios) y pégala como valor de ADMIN_PASSWORD_HASH en Vercel:\n');
  console.log(hash + '\n');
  console.log('Después: Vercel → Deployments → ⋯ → Redeploy (sin redeploy el cambio NO se aplica).\n');
})();
