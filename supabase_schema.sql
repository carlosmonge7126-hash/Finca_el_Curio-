-- ══════════════════════════════════════════════════════════
-- Finca El Curio · Esquema de base de datos para Supabase
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query
-- ══════════════════════════════════════════════════════════

create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text not null,
  telefono text,
  fecha date not null,
  tour text,
  horario text,
  created_at timestamptz not null default now()
);

-- Activar seguridad a nivel de fila
alter table public.reservas enable row level security;

-- Permitir que cualquier visitante (rol anon) pueda LEER las reservas
-- (lo usa index.html para mostrar cupos disponibles).
create policy "Lectura pública de reservas"
  on public.reservas
  for select
  to anon
  using (true);

-- NOTA: no se crea política de INSERT para "anon".
-- Los nuevos registros se insertan desde /api/reservar.mjs usando la
-- SUPABASE_SERVICE_ROLE_KEY, que se salta RLS. Esto es intencional:
-- evita que cualquier persona pueda escribir directo a la tabla desde
-- el navegador sin pasar por tu backend.

-- ══════════════════════════════════════════════════════════
-- Padrinos / Madrinas (aportes de "Ser Padrino")
-- Mismo patrón que "reservas": el admin puede LEER desde
-- cualquier dispositivo, pero solo se escribe vía /api/padrino.js
-- (con la SUPABASE_SERVICE_ROLE_KEY) para que nadie pueda insertar
-- basura directo desde el navegador.
-- ══════════════════════════════════════════════════════════
create table if not exists public.padrinos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text not null,
  telefono text,
  tipo_aporte text not null,
  mensaje text,
  created_at timestamptz not null default now()
);

alter table public.padrinos enable row level security;

create policy "Lectura pública de padrinos"
  on public.padrinos
  for select
  to anon
  using (true);

-- ══════════════════════════════════════════════════════════
-- Clientes (registro / login / planta asignada / visitas)
-- Esta tabla SÍ contiene contraseñas, así que NO se le da ninguna
-- política de acceso a "anon": ni lectura ni escritura directa desde
-- el navegador. Todo pasa por /api/clientes.js, que usa la
-- SUPABASE_SERVICE_ROLE_KEY (se salta RLS) y nunca devuelve la
-- contraseña al navegador.
-- ══════════════════════════════════════════════════════════
create table if not exists public.clientes (
  email text primary key,
  password text not null,
  nombre text not null,
  telefono text,
  codigo_planta text,
  visita boolean not null default false,
  fecha_visita timestamptz,
  fecha_registro timestamptz not null default now(),
  imagenes jsonb not null default '[]'::jsonb
);

alter table public.clientes enable row level security;
-- (sin políticas para "anon" a propósito: acceso solo vía service role)

-- ══════════════════════════════════════════════════════════
-- Plantas (código, imagen, comentarios del admin, avances)
-- Sin datos sensibles → mismo patrón "abierto" que configuracion_sitio:
-- cualquier visitante puede leer (para ver su planta asignada) y el
-- panel admin escribe directo con la clave anon.
-- ══════════════════════════════════════════════════════════
create table if not exists public.plantas (
  codigo text primary key,
  imagen text,
  comentario text,
  cliente_email text,
  fecha_asignacion timestamptz,
  historial_comentarios jsonb not null default '[]'::jsonb,
  actualizado_en timestamptz not null default now()
);

alter table public.plantas enable row level security;

create policy "Lectura pública de plantas"
  on public.plantas for select to anon using (true);
create policy "Escritura de plantas desde el sitio"
  on public.plantas for insert to anon with check (true);
create policy "Actualización de plantas desde el sitio"
  on public.plantas for update to anon using (true) with check (true);

-- ══════════════════════════════════════════════════════════
-- Testimonios / Historias de la finca (contenido público)
-- ══════════════════════════════════════════════════════════
create table if not exists public.testimonios (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  autor text not null,
  anon boolean not null default false,
  fecha timestamptz not null default now()
);

alter table public.testimonios enable row level security;

create policy "Lectura pública de testimonios"
  on public.testimonios for select to anon using (true);
create policy "Escritura de testimonios desde el sitio"
  on public.testimonios for insert to anon with check (true);
create policy "Eliminación de testimonios desde el sitio"
  on public.testimonios for delete to anon using (true);

-- ══════════════════════════════════════════════════════════
-- Configuración del sitio (logo, hero, imágenes de tours, etc.)
-- Así lo que el admin cambia lo ven TODOS los visitantes,
-- no solo el navegador donde se hizo el cambio.
-- ══════════════════════════════════════════════════════════
drop table if exists public.configuracion_sitio;

create table public.configuracion_sitio (
  clave text primary key,
  valor text,
  actualizado_en timestamptz not null default now()
);

alter table public.configuracion_sitio enable row level security;

-- Cualquier visitante puede LEER la configuración (para ver logo/imágenes)
create policy "Lectura pública de configuración"
  on public.configuracion_sitio
  for select
  to anon
  using (true);

-- El panel de admin (desde el navegador, con la clave anon) puede
-- escribir directamente. No es seguridad perfecta -el login de admin
-- de este sitio solo valida en el navegador-, pero es razonable para
-- un sitio de este tamaño.
create policy "Escritura de configuración desde el sitio"
  on public.configuracion_sitio
  for insert
  to anon
  with check (true);

create policy "Actualización de configuración desde el sitio"
  on public.configuracion_sitio
  for update
  to anon
  using (true)
  with check (true);

create policy "Eliminación de configuración desde el sitio"
  on public.configuracion_sitio
  for delete
  to anon
  using (true);
