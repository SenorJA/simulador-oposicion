/**
 * upload_banks.js — Sube los bancos de data/*.json a un bucket PRIVADO de
 * Supabase Storage ("preguntas") desde el que los sirve la Edge Function.
 *
 * La service_role se lee del entorno o de un fichero .env (gitignored).
 * NUNCA debe estar en el código ni en el frontend.
 *
 * Uso:
 *   node scripts/upload_banks.js --check   (no sube nada; solo lista y avisa)
 *   node scripts/upload_banks.js           (crea el bucket y sube los JSON)
 *
 * Variables (en .env o en el entorno):
 *   SUPABASE_URL=https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BUCKET = 'preguntas';
const DRY = process.argv.includes('--check');

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

    const files = fs.existsSync(DATA_DIR)
        ? fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort()
        : [];

    console.log(`Bancos a subir: ${files.length}`);
    for (const f of files) {
        const kb = (fs.statSync(path.join(DATA_DIR, f)).size / 1024).toFixed(0);
        console.log(`  · ${f} (${kb} KB)`);
    }

    if (DRY) {
        console.log('\nModo --check: no se ha subido nada.');
        if (!url || !key) console.log('(Aviso: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, pero --check no los necesita.)');
        return;
    }

    if (!url || !key) {
        console.error('\n✗ Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.');
        console.error('  Créalos en .env (gitignored) o expórtalos en el entorno.');
        process.exit(1);
    }
    if (!url.startsWith('https://')) {
        console.error('\n✗ SUPABASE_URL debe empezar por https://');
        process.exit(1);
    }
    // Acepta la secret key nueva (sb_secret_...) o la service_role JWT heredada (eyJ...)
    if (!key.startsWith('sb_secret_') && !key.startsWith('eyJ')) {
        console.error('\n✗ La clave no parece una service_role/secret key.');
        console.error('  Debe ser sb_secret_... o un JWT de service_role (eyJ...).');
        console.error('  No uses la publishable/anon aquí: no sirve para escribir en Storage.');
        process.exit(1);
    }

    const headers = { apikey: key, Authorization: `Bearer ${key}` };

    // 1) Crear el bucket si no existe (privado)
    const create = await fetch(`${url}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false })
    });
    if (create.ok) console.log(`\n✓ Bucket "${BUCKET}" creado (privado).`);
    else {
        const txt = await create.text();
        if (/already exists|Duplicate/i.test(txt)) console.log(`\n· Bucket "${BUCKET}" ya existe.`);
        else { console.error(`\n✗ No se pudo crear el bucket: HTTP ${create.status} ${txt.slice(0, 200)}`); process.exit(1); }
    }

    // 2) Subir cada JSON (x-upsert para poder re-subir)
    let ok = 0, fail = 0;
    for (const f of files) {
        const bytes = fs.readFileSync(path.join(DATA_DIR, f));
        const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(f)}`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'x-upsert': 'true' },
            body: bytes
        });
        if (res.ok) { ok++; console.log(`  ✓ ${f}`); }
        else { fail++; console.error(`  ✗ ${f}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`); }
    }

    console.log(`\nSubidos: ${ok} | Fallos: ${fail}`);
    if (fail) process.exit(1);
    console.log('Hecho. Recuerda desplegar la función:');
    console.log('  supabase functions deploy get-bank --no-verify-jwt --project-ref <ref>');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
