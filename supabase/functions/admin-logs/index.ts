/**
 * admin-logs — panel de administración.
 *
 * Solo responde a un usuario con `es_admin = true` (comprobado con el token).
 * Con RLS activo es el único camino para leer o cambiar licencias.
 *
 * Sin `action` → devuelve licencias + últimas conexiones.
 * Con `action`  → ejecuta y devuelve la lista actualizada:
 *   - block / unblock        (bloquear / desbloquear)
 *   - reset_password         (nueva contraseña)
 *   - reset_devices          (liberar los dispositivos)
 *
 * Se despliega con --no-verify-jwt (la puerta es el token + es_admin).
 */
import { verifyToken, hashPassword } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status: number) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
}

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const escapeLike = (u: string) => u.replace(/[\\%_]/g, (m) => '\\' + m);

async function esAdmin(user: string): Promise<boolean> {
    const q = new URLSearchParams({ id_acceso: `ilike.${escapeLike(user)}`, select: 'es_admin', limit: '1' });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?${q}`, { headers });
    if (!res.ok) return false;
    const rows = await res.json();
    return !!(rows[0] && rows[0].es_admin === true);
}

async function listar() {
    const [licsRes, logsRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?select=id_acceso,nombre,bloqueado,dispositivos_usados,es_admin&order=id_acceso`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/access_logs?select=created_at,device_info&order=created_at.desc&limit=30`, { headers })
    ]);
    if (!licsRes.ok || !logsRes.ok) return null;
    return { licenses: await licsRes.json(), logs: await logsRes.json() };
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    let body: { token?: unknown; action?: unknown; id_acceso?: unknown; password?: unknown; bloqueado?: unknown; nombre?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Cuerpo JSON inválido' }, 400);
    }

    const user = await verifyToken(String(body.token ?? ''), SERVICE_KEY);
    if (!user) return json({ error: 'Sesión no válida o caducada' }, 401);

    try {
        if (!(await esAdmin(user))) return json({ error: 'No autorizado' }, 403);
    } catch {
        return json({ error: 'Error de conexión' }, 502);
    }

    const action = String(body.action ?? '');
    const id = String(body.id_acceso ?? '').trim();

    // ── Acciones (opcionales) ──
    if (action) {
        if (!id) return json({ error: 'Falta el usuario' }, 400);

        if (action === 'create') {
            if (!id || id.length > 64 || /[^A-Za-z0-9._@-]/.test(id)) return json({ error: 'Usuario no válido' }, 400);
            const password = String(body.password ?? '');
            if (password.length < 6) return json({ error: 'La contraseña es muy corta (mínimo 6)' }, 400);
            const password_hash = await hashPassword(password);
            const res = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({
                    id_acceso: id,
                    nombre: String(body.nombre || id),
                    bloqueado: false,
                    dispositivos_usados: 0,
                    password_hash
                })
            });
            if (!res.ok) return json({ error: 'No se pudo crear (¿ya existe?)' }, 409);
        } else if (action === 'block' || action === 'unblock') {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?id_acceso=eq.${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ bloqueado: action === 'block' })
            });
            if (!res.ok) return json({ error: 'No se pudo actualizar' }, 502);
        } else if (action === 'reset_password') {
            const password = String(body.password ?? '');
            if (password.length < 6) return json({ error: 'La contraseña es muy corta (mínimo 6)' }, 400);
            const password_hash = await hashPassword(password);
            const res = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?id_acceso=eq.${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ password_hash })
            });
            if (!res.ok) return json({ error: 'No se pudo cambiar la contraseña' }, 502);
        } else if (action === 'reset_devices') {
            const d = await fetch(`${SUPABASE_URL}/rest/v1/dispositivos?id_acceso=eq.${encodeURIComponent(id)}`, {
                method: 'DELETE', headers
            });
            if (!d.ok) return json({ error: 'No se pudieron liberar los dispositivos' }, 502);
            const u = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?id_acceso=eq.${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ dispositivos_usados: 0 })
            });
            if (!u.ok) return json({ error: 'No se pudo resetear el contador' }, 502);
        } else {
            return json({ error: 'Acción no válida' }, 400);
        }
    }

    // ── Lista (siempre) ──
    try {
        const data = await listar();
        if (!data) return json({ error: 'Error leyendo los datos' }, 502);
        return json({ ok: true, ...data });
    } catch {
        return json({ error: 'Error leyendo los datos' }, 502);
    }
});
