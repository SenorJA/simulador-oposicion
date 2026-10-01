/**
 * login — valida usuario + contraseña, registra el dispositivo (límite 2) y
 * devuelve un token de sesión firmado.
 *
 * La contraseña se comprueba AQUÍ, en el servidor (PBKDF2), nunca en el
 * navegador. El registro de dispositivos es atómico (RPC con FOR UPDATE), así
 * que dos navegadores a la vez no pueden superar el límite.
 *
 * Modos:
 *   { user, password, deviceId }  → login; devuelve token
 *   { token, deviceId }           → valida la sesión guardada
 *
 * Se despliega con --no-verify-jwt (la puerta es usuario+contraseña).
 */
import { verifyPassword, signToken, verifyToken } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TOKEN_SECRET = SERVICE_KEY; // clave de firma; nunca sale del servidor
const MAX_DEVICES = 2;
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

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

async function fetchUser(user: string) {
    const q = new URLSearchParams({
        id_acceso: `ilike.${escapeLike(user)}`,
        select: 'id_acceso,nombre,bloqueado,dispositivos_usados,password_hash,intentos_fallidos,bloqueado_hasta',
        limit: '1'
    });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?${q}`, { headers });
    if (!res.ok) return { error: 'db' as const };
    const rows = await res.json();
    return { row: Array.isArray(rows) && rows[0] ? rows[0] : null };
}

/** Actualiza campos de un usuario (uso interno, service_role). */
async function patchUser(id: string, patch: Record<string, unknown>) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?id_acceso=eq.${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify(patch)
        });
    } catch { /* no bloquear el login por no poder actualizar el contador */ }
}

/** Registro atómico del dispositivo (límite 2) en el servidor. */
async function registrarDispositivo(id_acceso: string, device_id: string) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_dispositivo`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_id_acceso: id_acceso, p_device_id: device_id, p_maximo: MAX_DEVICES })
        });
        if (!res.ok) return { ok: false, motivo: 'DB', contador: 0 };
        const rows = await res.json();
        return rows[0] || { ok: false, motivo: 'DB', contador: 0 };
    } catch {
        return { ok: false, motivo: 'DB', contador: 0 };
    }
}

const motivoTexto = (motivo: string) => motivo === 'LIMITE_ALCANZADO'
    ? `Acceso denegado. Esta licencia ya ha alcanzado el límite máximo de ${MAX_DEVICES} dispositivos permitidos.`
    : 'No se pudo validar el dispositivo de acceso.';

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    let body: { user?: unknown; password?: unknown; token?: unknown; deviceId?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Cuerpo JSON inválido' }, 400);
    }

    const deviceId = String(body.deviceId ?? '').slice(0, 128);

    // ── Modo token: validar la sesión guardada ──
    if (body.token) {
        const user = await verifyToken(String(body.token), TOKEN_SECRET);
        if (!user) return json({ ok: false, error: 'Sesión caducada. Vuelve a entrar.' }, 401);

        const { row, error } = await fetchUser(user);
        if (error) return json({ error: 'Error consultando la licencia' }, 502);
        if (!row) return json({ ok: false, error: 'Usuario no válido' }, 403);
        if (row.bloqueado === true) return json({ ok: false, error: 'Licencia bloqueada' }, 403);

        if (deviceId) {
            const reg = await registrarDispositivo(row.id_acceso, deviceId);
            if (!reg.ok) return json({ ok: false, error: motivoTexto(reg.motivo) }, 403);
        }
        return json({
            ok: true, user: row.id_acceso, nombre: row.nombre,
            dispositivos_usados: row.dispositivos_usados || 0, token: String(body.token)
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

    // Límite de intentos (anti fuerza bruta)
    if (row.bloqueado_hasta && Date.now() < new Date(row.bloqueado_hasta).getTime()) {
        const min = Math.ceil((new Date(row.bloqueado_hasta).getTime() - Date.now()) / 60000);
        return json({ ok: false, error: `Demasiados intentos fallidos. Prueba de nuevo en ${min} min.` }, 429);
    }

    if (!row.password_hash) return json({ ok: false, error: 'Usuario sin contraseña configurada' }, 403);

    const okPw = await verifyPassword(password, row.password_hash);
    if (!okPw) {
        const intentos = (row.intentos_fallidos || 0) + 1;
        const patch: Record<string, unknown> = intentos >= MAX_INTENTOS
            ? { intentos_fallidos: 0, bloqueado_hasta: new Date(Date.now() + BLOQUEO_MS).toISOString() }
            : { intentos_fallidos: intentos };
        await patchUser(row.id_acceso, patch);
        const msg = intentos >= MAX_INTENTOS
            ? 'Demasiados intentos fallidos. Cuenta bloqueada 15 minutos.'
            : 'Usuario o contraseña incorrectos';
        return json({ ok: false, error: msg }, 403);
    }

    // Éxito: limpia el contador de intentos
    if (row.intentos_fallidos) await patchUser(row.id_acceso, { intentos_fallidos: 0 });

    const reg = await registrarDispositivo(row.id_acceso, deviceId || 'sin_device');
    if (!reg.ok) return json({ ok: false, error: motivoTexto(reg.motivo) }, 403);

    const token = await signToken(row.id_acceso, TOKEN_SECRET);
    return json({
        ok: true, user: row.id_acceso, nombre: row.nombre,
        dispositivos_usados: reg.contador || 0, token
    });
});
