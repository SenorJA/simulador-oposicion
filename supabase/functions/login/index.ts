/**
 * login — valida usuario + contraseña y devuelve un token de sesión firmado.
 *
 * La contraseña se comprueba AQUÍ, en el servidor (PBKDF2), nunca en el
 * navegador. El token se firma con un secreto que solo vive en el servidor.
 *
 * Modos:
 *   { user, password }  → login; devuelve token
 *   { token }           → valida la sesión guardada; devuelve el usuario
 *
 * Se despliega con --no-verify-jwt (la puerta es usuario+contraseña).
 */
import { verifyPassword, signToken, verifyToken } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TOKEN_SECRET = SERVICE_KEY; // clave de firma; nunca sale del servidor

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

function escapeLike(u: string) {
    return u.replace(/[\\%_]/g, (m) => '\\' + m);
}

async function fetchUser(user: string) {
    const q = new URLSearchParams({
        id_acceso: `ilike.${escapeLike(user)}`,
        select: 'id_acceso,nombre,bloqueado,dispositivos_usados,password_hash',
        limit: '1'
    });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?${q}`, { headers });
    if (!res.ok) return { error: 'db' as const };
    const rows = await res.json();
    return { row: Array.isArray(rows) && rows[0] ? rows[0] : null };
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    let body: { user?: unknown; password?: unknown; token?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Cuerpo JSON inválido' }, 400);
    }

    // ── Modo token: validar la sesión guardada ──
    if (body.token) {
        const user = await verifyToken(String(body.token), TOKEN_SECRET);
        if (!user) return json({ ok: false, error: 'Sesión caducada. Vuelve a entrar.' }, 401);
        const { row, error } = await fetchUser(user);
        if (error) return json({ error: 'Error consultando la licencia' }, 502);
        if (!row) return json({ ok: false, error: 'Usuario no válido' }, 403);
        if (row.bloqueado === true) return json({ ok: false, error: 'Licencia bloqueada' }, 403);
        return json({
            ok: true, user: row.id_acceso, nombre: row.nombre,
            bloqueado: false, dispositivos_usados: row.dispositivos_usados || 0,
            token: String(body.token)
        });
    }

    // ── Modo usuario + contraseña ──
    const user = String(body.user ?? '').trim();
    const password = String(body.password ?? '');
    if (!user || user.length > 64 || /[^A-Za-z0-9._@-]/.test(user)) {
        return json({ ok: false, error: 'Usuario no válido' }, 400);
    }
    if (!password) return json({ ok: false, error: 'Introduce la contraseña' }, 400);

    const { row, error } = await fetchUser(user);
    if (error) return json({ error: 'Error consultando la licencia' }, 502);
    if (!row) return json({ ok: false, error: 'Usuario o contraseña incorrectos' }, 403);
    if (row.bloqueado === true) return json({ ok: false, error: 'Licencia bloqueada' }, 403);
    if (!row.password_hash) return json({ ok: false, error: 'Usuario sin contraseña configurada' }, 403);

    const okPw = await verifyPassword(password, row.password_hash);
    if (!okPw) return json({ ok: false, error: 'Usuario o contraseña incorrectos' }, 403);

    const token = await signToken(row.id_acceso, TOKEN_SECRET);
    return json({
        ok: true, user: row.id_acceso, nombre: row.nombre,
        bloqueado: false, dispositivos_usados: row.dispositivos_usados || 0, token
    });
});
