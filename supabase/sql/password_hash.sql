-- Añade la columna de contraseña (hash PBKDF2) a usuarios_acceso.
-- Ejecútalo una vez en el SQL Editor de Supabase.
-- El hash lo genera scripts/set_password.js; nunca se guarda la contraseña.

alter table public.usuarios_acceso
    add column if not exists password_hash text;

-- (Recomendado) Activa RLS cuando todo esté probado:
--   alter table public.usuarios_acceso enable row level security;
--   alter table public.access_logs enable row level security;
-- Con RLS y sin políticas, la clave pública no puede leer ni escribir estas
-- tablas; todo el acceso pasa por las Edge Functions con la service_role.
