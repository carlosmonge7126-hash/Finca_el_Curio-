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
