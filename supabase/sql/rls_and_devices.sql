-- Seguridad: dispositivos + RLS.
-- Ejecútalo en el SQL Editor de Supabase (o vía Management API).
--
-- Tras esto:
--   · El navegador YA NO puede leer ni escribir usuarios_acceso / access_logs /
--     dispositivos con la clave pública (RLS activo y sin políticas).
--   · Todo el acceso pasa por las Edge Functions con la service_role.

-- 1) Marca de administrador
alter table public.usuarios_acceso
    add column if not exists es_admin boolean not null default false;

-- 2) Tabla de dispositivos por usuario (límite duro, sin carreras)
create table if not exists public.dispositivos (
    id_acceso  text not null,
    device_id  text not null,
    created_at timestamptz not null default now(),
    primary key (id_acceso, device_id)
);

-- 3) Registro ATÓMICO de dispositivo (bloquea la fila del usuario con FOR UPDATE,
--    así dos navegadores a la vez no pueden colarse). La llama la Edge Function.
create or replace function public.registrar_dispositivo(
    p_id_acceso text,
    p_device_id text,
    p_maximo    int default 2
)
returns table (ok boolean, contador int, motivo text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_bloqueado boolean;
    v_count     int;
    v_existe    boolean;
begin
    select bloqueado into v_bloqueado
      from usuarios_acceso
     where id_acceso = p_id_acceso
     for update;                      -- serializa registros concurrentes

    if not found then
        return query select false, 0, 'CODIGO_INVALIDO';
        return;
    end if;
    if v_bloqueado is true then
        return query select false, 0, 'BLOQUEADO';
        return;
    end if;

    select exists(
        select 1 from dispositivos
         where id_acceso = p_id_acceso and device_id = p_device_id
    ) into v_existe;

    select count(*) into v_count from dispositivos where id_acceso = p_id_acceso;

    if v_existe then
        update usuarios_acceso set dispositivos_usados = v_count where id_acceso = p_id_acceso;
        return query select true, v_count, 'YA_REGISTRADO';
        return;
    end if;

    if v_count >= p_maximo then
        return query select false, v_count, 'LIMITE_ALCANZADO';
        return;
    end if;

    insert into dispositivos (id_acceso, device_id) values (p_id_acceso, p_device_id);
    update usuarios_acceso set dispositivos_usados = v_count + 1 where id_acceso = p_id_acceso;
    return query select true, v_count + 1, 'REGISTRADO';
end;
$$;

-- Solo la service_role (Edge Functions) puede ejecutarla
revoke all on function public.registrar_dispositivo(text, text, int) from public, anon, authenticated;

-- 4) Activar RLS (sin políticas => anon/authenticated no pueden leer ni escribir)
alter table public.usuarios_acceso enable row level security;
alter table public.access_logs      enable row level security;
alter table public.dispositivos     enable row level security;

-- 5) Marcar al administrador (ajusta el código si hace falta)
update public.usuarios_acceso set es_admin = true where id_acceso ilike 'PichonJefe';
