-- Sincronización del progreso entre dispositivos.
-- Ejecútalo en el SQL Editor de Supabase (o vía Management API).

create table if not exists public.progreso (
    id_acceso  text primary key,
    data       jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

-- Con RLS y sin políticas, solo las Edge Functions (service_role) acceden.
alter table public.progreso enable row level security;
