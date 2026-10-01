/**
 * admin-logs — devuelve el estado de licencias y las últimas conexiones.
 *
 * Solo responde a un usuario con `es_admin = true`, comprobado en el servidor a
 * partir del token. Con RLS activo, el navegador no puede leer estas tablas, así
 * que este es el único camino.
 *
 * Se despliega con --no-verify-jwt (la puerta es el token + es_admin).
 */
import { verifyToken } from '../_shared/crypto.ts';

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

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    let body: { token?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Cuerpo JSON inválido' }, 400);
    }

    const user = await verifyToken(String(body.token ?? ''), SERVICE_KEY);
    if (!user) return json({ error: 'Sesión no válida o caducada' }, 401);

    // Comprobar que el token corresponde a un administrador
    try {
        const q = new URLSearchParams({ id_acceso: `ilike.${escapeLike(user)}`, select: 'es_admin', limit: '1' });
        const res = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?${q}`, { headers });
        if (!res.ok) return json({ error: 'Error consultando permisos' }, 502);
        const rows = await res.json();
        if (!rows[0] || rows[0].es_admin !== true) return json({ error: 'No autorizado' }, 403);
    } catch {
        return json({ error: 'Error de conexión' }, 502);
    }

    // Datos para el panel
    try {
        const [licsRes, logsRes] = await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?select=id_acceso,nombre,bloqueado,dispositivos_usados,es_admin&order=dispositivos_usados.desc`, { headers }),
            fetch(`${SUPABASE_URL}/rest/v1/access_logs?select=created_at,device_info&order=created_at.desc&limit=30`, { headers })
        ]);
        if (!licsRes.ok || !logsRes.ok) return json({ error: 'Error leyendo los datos' }, 502);
        const licenses = await licsRes.json();
        const logs = await logsRes.json();
        return json({ ok: true, licenses, logs });
    } catch {
        return json({ error: 'Error leyendo los datos' }, 502);
    }
});
