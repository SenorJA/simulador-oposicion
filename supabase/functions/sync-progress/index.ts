/**
 * sync-progress — guarda y recupera el progreso del usuario entre dispositivos.
 *
 * Requiere un token válido. El servidor FUSIONA lo que llega con lo guardado
 * (unión de fallos/dudosas, máximo de récords y contadores, historial unido) y
 * devuelve el resultado, así ninguna de las dos partes pierde datos.
 *
 *   POST { token, data }  → fusiona, guarda y devuelve { ok, data }
 *   POST { token }        → devuelve { ok, data } (lo guardado)
 *
 * Se despliega con --no-verify-jwt (la puerta es el token).
 */
import { verifyToken } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

function json(body: unknown, status: number) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
}

const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
const numero = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Fusiona un valor según el tipo de clave. */
function mergeValue(key: string, a: string, b: string): string {
    const A = safeJson(a);
    const B = safeJson(b);

    if (key.endsWith('ope_failed_ids') || key.endsWith('ope_dudosas')) {
        const set = new Set([...(Array.isArray(A) ? A : []), ...(Array.isArray(B) ? B : [])]);
        return JSON.stringify([...set]);
    }
    if (key.includes('simulador_sescam_records')) {
        const out: Record<string, number> = { ...(A || {}) };
        for (const [t, s] of Object.entries(B || {})) out[t] = Math.max(out[t] || 0, numero(s));
        return JSON.stringify(out);
    }
    if (key.endsWith('ope_progress')) {
        const arr = [...(Array.isArray(A) ? A : []), ...(Array.isArray(B) ? B : [])];
        const vistos = new Set<string>();
        const uniq = arr.filter(e => {
            const k = `${e?.date}|${e?.topic}|${e?.score}`;
            if (vistos.has(k)) return false;
            vistos.add(k);
            return true;
        });
        uniq.sort((x, y) => String(y?.date || '').localeCompare(String(x?.date || '')));
        return JSON.stringify(uniq.slice(0, 50));
    }
    if (key.endsWith('ope_attempts')) {
        const out: Record<string, unknown[]> = { ...(A || {}) };
        for (const [t, arr] of Object.entries(B || {})) {
            const a = Array.isArray(out[t]) ? out[t] : [];
            const b = Array.isArray(arr) ? arr : [];
            out[t] = a.length >= b.length ? a : b;
        }
        return JSON.stringify(out);
    }
    if (key.endsWith('ope_answered') || key.endsWith('ope_streak')) {
        return String(Math.max(numero(A), numero(B)));
    }
    if (key.endsWith('ope_streak_date')) {
        return String(a) > String(b) ? a : b;
    }
    // Desconocida: conserva la más reciente por longitud (heurística segura)
    return b.length >= a.length ? b : a;
}

/** Claves de la sesión suspendida: son del dispositivo, no se sincronizan. */
const esDeSesion = (k: string) => k.includes('estado_test_suspendido');

function mergeAll(base: Record<string, string>, incoming: Record<string, string>) {
    const out: Record<string, string> = { ...base };
    for (const [k, v] of Object.entries(incoming || {})) {
        if (typeof v !== 'string' || esDeSesion(k)) continue;
        out[k] = k in out ? mergeValue(k, out[k], v) : v;
    }
    return out;
}

async function leer(user: string): Promise<Record<string, string>> {
    const q = new URLSearchParams({ id_acceso: `eq.${encodeURIComponent(user)}`, select: 'data', limit: '1' });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/progreso?${q}`, { headers });
    if (!res.ok) return {};
    const rows = await res.json();
    return (rows[0] && rows[0].data) || {};
}

async function guardar(user: string, data: Record<string, string>) {
    await fetch(`${SUPABASE_URL}/rest/v1/progreso?on_conflict=id_acceso`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id_acceso: user, data, updated_at: new Date().toISOString() })
    });
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    let body: { token?: unknown; data?: unknown; replace?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Cuerpo JSON inválido' }, 400);
    }

    const user = await verifyToken(String(body.token ?? ''), SERVICE_KEY);
    if (!user) return json({ error: 'Sesión no válida o caducada' }, 401);

    try {
        const guardado = await leer(user);
        if (body.data && typeof body.data === 'object') {
            const incoming = body.data as Record<string, string>;
            // `replace` (p. ej. tras borrar el progreso) SOBRESCRIBE en vez de fusionar
            let fusion: Record<string, string>;
            if (body.replace === true) {
                fusion = {};
                for (const [k, v] of Object.entries(incoming)) {
                    if (typeof v === 'string' && !esDeSesion(k)) fusion[k] = v;
                }
            } else {
                fusion = mergeAll(guardado, incoming);
            }
            await guardar(user, fusion);
            return json({ ok: true, data: fusion });
        }
        return json({ ok: true, data: guardado });
    } catch {
        return json({ error: 'Error sincronizando el progreso' }, 502);
    }
});
