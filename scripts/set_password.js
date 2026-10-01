/**
 * set_password.js — Crea/actualiza un usuario con su contraseña (hash PBKDF2).
 *
 * El hash se genera en local; la contraseña nunca se envía ni se guarda en claro.
 * El formato coincide con el que verifica la Edge Function `login`.
 *
 * Uso:
 *   node scripts/set_password.js <usuario> <contraseña> [--name "Nombre"]
 *   node scripts/set_password.js --list          (lista usuarios y si tienen contraseña)
 *
 * Necesita .env con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ITER = 100000;

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

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(password, salt, ITER, 32, 'sha256');
    return `pbkdf2$${ITER}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

const env = loadEnv();
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('✗ Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env'); process.exit(1); }
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const escapeLike = (u) => u.replace(/[\\%_]/g, (m) => '\\' + m);

async function findUser(user) {
    const q = new URLSearchParams({ id_acceso: `ilike.${escapeLike(user)}`, select: 'id_acceso', limit: '1' });
    const res = await fetch(`${url}/rest/v1/usuarios_acceso?${q}`, { headers });
    if (!res.ok) throw new Error('consulta: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
    const rows = await res.json();
    return rows[0] || null;
}

async function main() {
    const args = process.argv.slice(2);

    if (args[0] === '--list') {
        const res = await fetch(`${url}/rest/v1/usuarios_acceso?select=id_acceso,nombre,bloqueado,dispositivos_usados,password_hash&order=id_acceso`, { headers });
        if (!res.ok) { console.error('✗ HTTP', res.status, (await res.text()).slice(0, 200)); process.exit(1); }
        const rows = await res.json();
        console.log(`${rows.length} usuarios:`);
        for (const r of rows) {
            console.log(`  ${r.id_acceso}  ${r.nombre || ''}  ${r.bloqueado ? '(bloqueado)' : ''}  ${r.password_hash ? '· con contraseña' : '· SIN contraseña'}`);
        }
        return;
    }

    const [user, password] = args;
    const nameIdx = args.indexOf('--name');
    const nombre = nameIdx >= 0 ? args[nameIdx + 1] : null;

    if (!user || !password) {
        console.error('Uso: node scripts/set_password.js <usuario> <contraseña> [--name "Nombre"]');
        process.exit(1);
    }
    if (password.length < 6) console.warn('⚠ La contraseña es muy corta (recomendado 8+).');

    const existente = await findUser(user);
    const password_hash = hashPassword(password);

    if (existente) {
        const body = JSON.stringify(nombre ? { password_hash, nombre } : { password_hash });
        const res = await fetch(`${url}/rest/v1/usuarios_acceso?id_acceso=eq.${encodeURIComponent(existente.id_acceso)}`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body
        });
        if (!res.ok) { console.error('✗ HTTP', res.status, (await res.text()).slice(0, 200)); process.exit(1); }
        console.log(`✓ Contraseña actualizada${nombre ? ' y nombre' : ''} para "${existente.id_acceso}".`);
    } else {
        const res = await fetch(`${url}/rest/v1/usuarios_acceso`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ id_acceso: user, nombre: nombre || user, bloqueado: false, dispositivos_usados: 0, password_hash })
        });
        if (!res.ok) { console.error('✗ HTTP', res.status, (await res.text()).slice(0, 200)); process.exit(1); }
        console.log(`✓ Usuario "${user}" creado con contraseña.`);
    }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
