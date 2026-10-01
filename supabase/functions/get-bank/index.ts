/**
 * get-bank — única puerta de acceso a los bancos de preguntas.
 *
 * El bucket "preguntas" es PRIVADO: nadie puede leerlo directamente.
 * Esta función:
 *   1. recibe { bank, user } (user = código de licencia),
 *   2. valida el código server-side contra usuarios_acceso,
 *   3. descarga el JSON del bucket con la service_role y lo devuelve.
 *
 * Se despliega con --no-verify-jwt: la puerta es la licencia, no el JWT.
 * La service_role la inyecta Supabase en el entorno; NUNCA viaja al navegador.
 */

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

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

    let body: { bank?: unknown; user?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Cuerpo JSON inválido' }, 400);
    }

    const bank = String(body.bank ?? '');
    const user = String(body.user ?? '').trim();

    // Nombre de fichero acotado: evita path traversal y nombres raros
    if (!/^[a-z0-9_]+\.json$/i.test(bank)) return json({ error: 'Banco no válido' }, 400);
    // Código acotado: sin saltos ni comodines LIKE
    if (!user || user.length > 64 || /[^A-Za-z0-9._@-]/.test(user)) {
        return json({ error: 'Código no válido' }, 400);
    }

    const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

    // 1) Validar licencia (ILIKE para no depender de mayúsculas). Se escapan
    //    los comodines de LIKE para que el código no pueda coincidir "de más".
    try {
        const pattern = user.replace(/[\\%_]/g, (m) => '\\' + m);
        const q = new URLSearchParams({
            id_acceso: `ilike.${pattern}`,
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

    // 2) Servir el banco desde el bucket privado
    try {
        const res = await fetch(
            `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${bank}`,
            { headers }
        );
        if (!res.ok) return json({ error: 'Banco no encontrado' }, 404);

        const text = await res.text();
        return new Response(text, {
            headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
    } catch {
        return json({ error: 'Error leyendo el banco' }, 502);
    }
});
