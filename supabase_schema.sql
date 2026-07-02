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
