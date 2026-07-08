# Finca El Curio — Correcciones aplicadas

## Bugs encontrados y corregidos

1. **`api/reservar.mjs`**: el import estaba roto (`from "https://esm.sh"`, sin
   paquete). Node/Vercel no puede importar así. Se corrigió a
   `import { createClient } from '@supabase/supabase-js'`.
2. **`package.json`**: faltaba la dependencia `@supabase/supabase-js`
   (todas las funciones en `/api` la usan, pero no estaba instalada — el
   deploy habría fallado). Se agregó, junto con `"type": "module"` para que
   Vercel interprete correctamente el `import` de los archivos `.js`. Se
   quitó `pg`, que no se usa en ningún archivo del proyecto.
3. **`index.html` nunca cargaba el SDK de Supabase**: no existía ningún
   `<script src="...supabase...">` en el HTML, por lo que
   `typeof supabase` siempre era `undefined` y la app nunca llegaba a
   conectarse (solo mostraba el warning en consola). Se agregó el script
   del SDK antes del bloque de código principal.
4. **Doble envío de reservas**: el botón "Confirmar Reserva" tenía dos
   manejadores a la vez (`onclick="procesarReserva()"` en el HTML +
   `addEventListener('click', hacerReserva)` en JS), así que cada clic
   ejecutaba dos flujos distintos y podía duplicar la reserva. Se eliminó
   la función `hacerReserva()` (guardaba solo en localStorage, no en
   Supabase) y se dejó únicamente `procesarReserva()`.
5. **Las reservas no se guardaban en Supabase**: `procesarReserva()` solo
   mandaba los datos a Google Sheets y a `localStorage`, nunca al backend.
   Se agregó `enviarReservaSupabase()`, que llama a `/api/reservar` (ya
   existía la función serverless, pero nada la invocaba).
6. Se eliminó `Completo.pnj`, un archivo de texto vacío sin ningún uso.

## Lo que necesitas configurar tú (no lo puedo rellenar por ti)

### 1. Variables de entorno en Vercel (Project Settings → Environment Variables)
- `NEXT_PUBLIC_SUPABASE_URL` → URL de tu proyecto (Supabase → Settings → API)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → tu clave "anon public"
- `SUPABASE_URL` → la misma URL de arriba
- `SUPABASE_SERVICE_ROLE_KEY` → tu clave "service_role" (secreta, nunca la
  pongas en el frontend)

### 2. Credenciales en el propio `index.html`
Busca estas líneas (cerca del final del `<script>`) y reemplázalas con tu
URL y anon key reales:

```js
const SUPABASE_URL = 'https://TU_PROYECTO_ID.supabase.co';
const SUPABASE_ANON_KEY = 'TU_ANON_KEY_AQUI';
```

### 3. Crear la tabla en Supabase
Corre el archivo `supabase_schema.sql` en el SQL Editor de tu proyecto
Supabase. Crea la tabla `reservas` con las columnas que ya usa el código
(`nombre`, `email`, `telefono`, `fecha`, `tour`, `horario`, `created_at`) y
las políticas de seguridad (RLS) necesarias.

### 4. Habilitar Auth por email en Supabase
`api/login.js` y `api/register.js` usan `supabase.auth.signUp` /
`signInWithPassword`. Confirma en Supabase → Authentication → Providers
que el proveedor "Email" esté activo.

## Actualización: las imágenes del admin ahora se sincronizan para todos

Antes, cuando el admin subía logo/hero/imágenes de tours, esos cambios
solo quedaban guardados en el navegador del admin (`localStorage`), por
eso los clientes no los veían. Se agregó:

- Tabla nueva `configuracion_sitio` en Supabase (está en
  `supabase_schema.sql` — tienes que volver a correr ese archivo
  completo en el SQL Editor para crear esta tabla nueva).
- Cuando el admin sube o borra una imagen, ahora también se guarda/borra
  en esa tabla (además de en su propio navegador).
- Cuando cualquier visitante entra al sitio, `index.html` descarga esa
  configuración de Supabase y la aplica automáticamente.

⚠️ **Importante**: las imágenes se guardan como texto (base64) en la
base de datos, no como archivos reales de un bucket de almacenamiento.
Esto es más simple de configurar, pero funciona mejor con imágenes
livianas (idealmente menos de 1-2 MB cada una). Si subes fotos muy
pesadas directo de una cámara/celular, comprímelas antes de subirlas o
avísame y armamos la versión con Supabase Storage (buckets), que es más
robusta para archivos grandes.

## Actualización: los registros de "Ser Padrino/Madrina" ahora se sincronizan

Mismo problema que las imágenes: cuando un cliente elegía sus aportes en
"Ser Padrino", eso solo quedaba en `localStorage` del navegador del
cliente. El admin, desde otro dispositivo, nunca lo veía. Se agregó:

- Tabla nueva `padrinos` en Supabase (está en `supabase_schema.sql` —
  vuelve a correr ese archivo completo en el SQL Editor para crearla).
- `api/padrino.js`: nuevo endpoint serverless que guarda el registro en
  Supabase usando `SUPABASE_SERVICE_ROLE_KEY` (mismo patrón seguro que
  `api/reservar.mjs`; nadie puede escribir directo a la tabla desde el
  navegador).
- `registrarPadrino()` ahora llama a ese endpoint antes de guardar en
  localStorage, así que el registro queda en la nube.
- El admin descarga los padrinos de Supabase automáticamente al cargar
  la página y también cada vez que abre la pestaña "💚 Padrinos" del
  panel — igual que ya pasaba con "Reservas".

No necesitas configurar nada nuevo en Vercel: `api/padrino.js` usa las
mismas variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` que ya
tenías puestas para `api/reservar.mjs`. Solo falta correr el
`supabase_schema.sql` actualizado en Supabase para crear la tabla.

## Actualización grande: TODO el panel admin ahora sincroniza entre dispositivos

Se aplicó el mismo patrón (Supabase como "fuente de verdad", localStorage
como respaldo offline) a **todas** las secciones del admin, no solo a
Padrinos:

- **Clientes** (registro, login, planta asignada, si visitó, sus fotos):
  nueva tabla `clientes` + endpoint `/api/clientes.js`. Este es el único
  que usa `SUPABASE_SERVICE_ROLE_KEY` en vez de escritura directa, porque
  guarda contraseñas — así nunca quedan expuestas al navegador. Ahora un
  cliente puede registrarse en el celular e iniciar sesión desde la
  computadora, y el admin ve todos los clientes sin importar en qué
  dispositivo se registraron.
- **Plantas** (código, imagen, comentario del admin, avances): nueva
  tabla `plantas`, sincroniza igual que las imágenes del sitio (escritura
  directa desde el navegador, sin datos sensibles).
- **Historias / testimonios**: nueva tabla `testimonios`, visible para
  todos los visitantes y sincronizada en tiempo real.
- **Config general** (teléfono, horario, dirección, tours, textos,
  visibilidad de secciones) y **Bancos** (SINPE/IBAN): ahora también se
  guardan en la nube (reutilizando la tabla `configuracion_sitio`, bajo
  las claves `cfg_general` y `bancos`), no solo el logo/imágenes como
  antes.

### Dos bugs reales que encontré de paso (por los errores en tu consola)

1. **`toggleAporte` crasheaba siempre**: el código buscaba un elemento
   `id="infoAporteSel"` que nunca existió en el HTML, así que cada clic en
   una opción de "Ser Padrino" lanzaba `Cannot read properties of null`.
   Corregido.
2. **`guardar()` se detenía a medias si el localStorage se llenaba**: si
   `fec_cfg` superaba la cuota (por imágenes grandes guardadas como
   texto), el resto de las claves que venían después en la misma función
   (como `fec_bancos`) nunca se guardaban. Ahora cada clave se guarda por
   separado, así un fallo no bloquea a las demás. De todas formas, para
   evitar ese warning de cuota, sube imágenes livianas (menos de 1-2 MB).

### Qué tienes que hacer tú

1. Vuelve a correr el `supabase_schema.sql` completo y actualizado en el
   SQL Editor de Supabase (crea las tablas `clientes`, `plantas` y
   `testimonios` nuevas).
   ⚠️ Ese archivo tiene `drop table if exists public.configuracion_sitio`
   — al correrlo se borra y recrea esa tabla en particular. Como es la
   primera vez que vas a correr esta versión, no hay nada que perder,
   pero si en el futuro vuelves a correr el archivo completo, perderás lo
   que haya en `configuracion_sitio` (imágenes, `cfg_general`, `bancos`)
   y tendrás que volver a guardarlo desde el panel admin.
2. No hace falta ninguna variable de entorno nueva en Vercel; todo usa
   las que ya tenías (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

## Ronda de correcciones: reservas, testimonios y "completar"

1. **"Solo fines de semana" bloqueaba reservas viejas**: al asignar hora a
   una reserva que el cliente hizo ANTES de que activaras "solo fines de
   semana", el sistema comparaba esa restricción contra la fecha
   original y la rechazaba. Ahora la restricción solo aplica cuando el
   admin cambia la reserva a una fecha nueva; si se deja la fecha
   original, se respeta tal cual, sin importar la configuración actual.

2. **Reservas se duplicaban al refrescar / se perdía el horario
   asignado**: la causa real era que asignar un horario nunca se
   guardaba en Supabase, solo en el navegador del admin que lo asignó.
   Al refrescar, el sitio volvía a bajar la reserva "original" (sin
   horario) desde Supabase y la mezclaba mal con la versión local. Ahora:
   - Cada reserva nueva guarda su `id` real de Supabase.
   - Asignar/reasignar horario, o mover la fecha, se sube a Supabase al
     instante (`/api/reserva-actualizar.js`, nuevo).
   - La combinación de datos locales + nube ya no se hace por
     "email+fecha" (se rompía si cambiabas la fecha) sino por `id`, y
     nunca deja que una versión vieja de la nube borre un horario que ya
     habías asignado localmente.

3. **Testimonios sin sesión**: si alguien intenta publicar un testimonio
   sin haber iniciado sesión, ahora el mensaje de error lo manda directo
   al formulario de "Registrarse" después de un segundo, en vez de
   dejarlo estancado con el error.

4. **Nuevo: marcar reservas como "Completada"**: cada reserva activa
   tiene ahora un check "Completada" junto a "Cancelar". Al marcarla,
   se mueve automáticamente a la sección de abajo (ahora llamada
   "Cancelaciones / Completadas", con una etiqueta que dice si fue
   cancelada o completada) y desaparece de la lista de reservas activas.
   También agregué un botón "🧹 Limpiar todo" ahí para borrar todo ese
   historial de una vez. Cancelar y completar ahora también:
   - Borran la reserva de Supabase (`/api/reserva-eliminar.js`, nuevo) —
     así no reaparece al refrescar.
   - Guardan el registro en una tabla nueva `cancelaciones`, visible
     desde cualquier dispositivo.

### Qué tienes que hacer tú

Vuelve a correr el `supabase_schema.sql` (agrega la tabla `cancelaciones`
nueva). No se necesitan variables de entorno adicionales.

⚠️ **Prerrequisito**: esto solo funciona si la conexión a Supabase desde
el navegador está funcionando (ver sección de diagnóstico del error
`ERR_NAME_NOT_RESOLVED` que estamos resolviendo aparte). Si esa conexión
sigue fallando, las imágenes van a seguir viéndose solo en el navegador
del admin.

## Ronda de correcciones: correo de cancelación, recordatorio automático y foto fija en los correos

1. **Nuevo: correo automático cuando el admin cancela una reserva.** Se
   agregó `api/notificar-cancelacion.js`. Se dispara solo, justo después de
   que el admin confirma la cancelación en el modal — no hay que hacer
   nada extra. Si el correo falla por algún motivo, la cancelación en sí
   no se revierte (ya quedó guardada en Supabase/localStorage); solo se
   ve un aviso en la consola.

2. **Nuevo: recordatorio automático un día antes de la visita.** Se
   agregó `api/notificar-recordatorio.js`, disparado una vez al día por un
   **Vercel Cron Job** (configurado en `vercel.json`, corre a las 15:00 UTC
   = 9:00 a.m. hora de Costa Rica — puedes cambiar la hora editando el
   `"schedule"` en ese archivo). Cada vez que corre:
   - Busca en Supabase las reservas cuya fecha sea "mañana" y que ya
     tengan horario asignado.
   - Les manda un correo: "Te esperamos el día de mañana en Finca El
     Curio".
   - Marca cada una como `recordatorio_enviado = true` para no mandarlo
     dos veces si el cron llegara a correr más de una vez el mismo día.
   - Si una reserva todavía no tiene horario asignado, no se le manda
     nada (no hay una hora concreta que recordarle).

3. **Mensaje de confirmación al cancelar, más claro.** El aviso que
   aparece al darle "Cancelar" a una reserva ahora explica lo mismo que ya
   explicaba el de "Completada": que se le avisará al cliente por correo y
   que la reserva se moverá al historial.

4. **Foto fija (translúcida) en el encabezado de los tres correos**
   (confirmación, cancelación y recordatorio). Se usa la foto del camino
   empedrado de la finca como fondo del encabezado, con una capa verde
   semitransparente encima para que el texto siga siendo legible; se ve
   más translúcida que antes, así se nota más la foto de fondo.
   - Se guardó como `fondo-correo.jpg` en la raíz del proyecto,
     comprimida a ~53KB (700x326px, calidad ajustada). Los archivos de
     fotos de cabañas que ya existían en el proyecto pesan entre 2 y 3 MB
     cada uno; usar una de esas directo en un correo habría sido un
     problema real, por eso se hizo una versión liviana aparte solo para
     esto.
   - Por qué no va "incrustada" en el correo (base64) sino como archivo
     aparte con URL: Gmail (y varios clientes de correo más) recortan los
     mensajes cuyo HTML pasa de ~102KB y muestran un enlace de "Ver
     mensaje completo" en vez de mostrar el correo entero de una vez. Si
     la imagen va incrustada en base64 dentro del HTML, cuenta contra ese
     límite y con una sola imagen ya se pasa. Sirviéndola como
     `https://tu-sitio.vercel.app/fondo-correo.jpg` (un archivo normal),
     el HTML del correo se queda en unos pocos KB y la imagen se descarga
     aparte, como cualquier imagen de una página web, así el correo nunca
     se ve cortado y no afecta la velocidad de envío.
   - La URL se arma sola a partir de la propia petición (usa el dominio
     desde el que Vercel sirve tu sitio), así que funciona igual en
     producción, en previews de Vercel o si conectas un dominio propio;
     no hay que configurar nada a mano.
   - Antes, el correo de confirmación usaba la imagen del "hero" que subes
     desde el panel (en base64, con un límite de tamaño). Eso se
     reemplazó por esta foto fija para los tres correos, así quedan
     visualmente iguales y no hay riesgo de que una imagen pesada del
     hero infle el correo.

### Qué tienes que hacer tú

1. Vuelve a correr el `supabase_schema.sql` completo y actualizado (agrega
   la columna `recordatorio_enviado` a la tabla `reservas`; es un `alter
   table ... add column if not exists`, no borra nada de lo que ya
   tengas).
2. No se necesita ninguna variable de entorno nueva para que esto
   funcione: reutiliza `GMAIL_USER`, `GMAIL_APP_PASSWORD`,
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` que ya tenías.
3. Opcional pero recomendado: agrega una variable de entorno
   `CRON_SECRET` en Vercel (Project Settings, Environment Variables, con
   cualquier valor largo y aleatorio). Vercel la usa automáticamente para
   autenticar sus propias llamadas al cron, así nadie más puede disparar
   `/api/notificar-recordatorio` manualmente desde afuera.
4. Los Cron Jobs de Vercel están disponibles incluso en el plan gratuito
   (Hobby), pero con el límite de que solo pueden correr una vez al día,
   que es exactamente lo que necesitamos aquí, así que no hay que cambiar
   de plan.
5. Después de desplegar, puedes probar el recordatorio a mano visitando
   `https://tu-sitio.vercel.app/api/notificar-recordatorio` en el
   navegador (si configuraste `CRON_SECRET`, esa prueba manual dará "No
   autorizado", es normal: Vercel sí manda el secreto cuando lo llama él
   mismo desde el cron; para probarlo a mano tendrías que quitar
   temporalmente `CRON_SECRET` o mandar el header `Authorization: Bearer
   TU_SECRETO` con una herramienta como Postman).

## Importante: el registro/login de clientes y el panel de admin

`index.html` maneja clientes, plantas, padrinos y el panel de
administración **enteramente con `localStorage`** (no con Supabase),
aunque exista `api/login.js` y `api/register.js` — el frontend nunca los
llama. Esto significa que esos datos:
- solo existen en el navegador de cada usuario (no se comparten entre
  dispositivos),
- no tienen relación real con la tabla `reservas` de Supabase.

No toqué esa parte porque reescribirla implica diseñar tablas nuevas
(`clientes`, `plantas`, `padrinos`) y rehacer bastante lógica del panel de
admin — es un cambio grande. Si quieres, puedo hacerlo en un siguiente
paso; dime y seguimos por ahí.
