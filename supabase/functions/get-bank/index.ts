/**
 * get-bank — única puerta de acceso a los bancos de preguntas.
 *
 * Exige un TOKEN de sesión válido (emitido por `login` tras usuario+contraseña).
 * Con solo conocer el código de usuario ya no basta para descargar las preguntas.
 * El bucket "preguntas" es privado y se lee con la service_role.
 */
import { verifyToken } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'preguntas';

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

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    let body: { bank?: unknown; token?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Cuerpo JSON inválido' }, 400);
    }

    const bank = String(body.bank ?? '');
    const token = String(body.token ?? '');

    // Nombre de fichero acotado: evita path traversal y nombres raros
    if (!/^[a-z0-9_]+\.json$/i.test(bank)) return json({ error: 'Banco no válido' }, 400);

    // 1) Token de sesión válido y vigente
    const user = await verifyToken(token, SERVICE_KEY);
    if (!user) return json({ error: 'Sesión no válida o caducada' }, 401);

    // 2) La licencia debe seguir existiendo y no estar bloqueada
    try {
        const q = new URLSearchParams({
            id_acceso: `ilike.${escapeLike(user)}`,
            select: 'id_acceso,bloqueado',
            limit: '1'
        });
        const res = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_acceso?${q}`, { headers });
        if (!res.ok) return json({ error: 'Error consultando la licencia' }, 502);
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'Licencia no válida' }, 403);
        if (rows[0].bloqueado === true) return json({ error: 'Licencia bloqueada' }, 403);
    } catch {
        return json({ error: 'Error de conexión con la base de datos' }, 502);
    }

    // 3) Servir el banco desde el bucket privado
    try {
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${bank}`, { headers });
        if (!res.ok) return json({ error: 'Banco no encontrado' }, 404);

        const text = await res.text();
        return new Response(text, {
            headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
    } catch {
        return json({ error: 'Error leyendo el banco' }, 502);
    }
});
