/**
 * download_banks.js — Restaura data/*.json desde el bucket privado de Supabase.
 * Útil en un clon limpio (data/ ya no está en el repo) o para recuperar copia.
 *
 * Uso:
 *   node scripts/download_banks.js --check   (solo lista lo que hay en el bucket)
 *   node scripts/download_banks.js           (descarga a data/)
 *
 * Variables (en .env o entorno): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BUCKET = 'preguntas';

function loadEnv() {
    const env = { ...process.env };
    const file = path.join(ROOT, '.env');
    if (fs.existsSync(file)) {
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
            if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    }
    return env;
}

async function main() {
    const env = loadEnv();
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const DRY = process.argv.includes('--check');

    if (!url || !key) {
        console.error('✗ Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY (.env).');
        process.exit(1);
    }
    const headers = { apikey: key, Authorization: `Bearer ${key}` };

    const listRes = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: '', limit: 200, offset: 0, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!listRes.ok) {
        console.error(`✗ No se pudo listar el bucket: HTTP ${listRes.status} ${(await listRes.text()).slice(0, 200)}`);
        process.exit(1);
    }
    const items = (await listRes.json()).filter(o => o.name && o.name.endsWith('.json'));
    console.log(`Bancos en el bucket: ${items.length}`);
    items.forEach(o => console.log(`  · ${o.name} (${(o.metadata?.size ?? 0) / 1024 | 0} KB)`));

    if (DRY) { console.log('\nModo --check: no se ha descargado nada.'); return; }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    let ok = 0;
    for (const o of items) {
        const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(o.name)}`, { headers });
        if (!res.ok) { console.error(`  ✗ ${o.name}: HTTP ${res.status}`); continue; }
        fs.writeFileSync(path.join(DATA_DIR, o.name), Buffer.from(await res.arrayBuffer()));
        ok++;
        console.log(`  ✓ ${o.name}`);
    }
    console.log(`\nDescargados: ${ok}/${items.length}`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
