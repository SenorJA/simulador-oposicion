/**
 * deploy_backend.js — Sube los bancos y despliega la Edge Function get-bank.
 *
 * Pasos que hace, en orden:
 *   1. data/*.json → bucket privado "preguntas"   (scripts/upload_banks.js)
 *   2. supabase functions deploy get-bank --no-verify-jwt
 *
 * Requisitos:
 *   - .env en la raíz con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
 *   - CLI de Supabase (o npx). Si no has hecho login:
 *       supabase login      (o pon SUPABASE_ACCESS_TOKEN en el .env)
 *
 * Uso: node scripts/deploy_backend.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

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

const env = loadEnv();

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗ Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env');
    process.exit(1);
}

const ref = (env.SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/) || [])[1];
if (!ref) {
    console.error('✗ No se pudo extraer el project-ref de SUPABASE_URL:', env.SUPABASE_URL);
    process.exit(1);
}

console.log('── 1/2 · Subiendo bancos al bucket privado ──');
const upload = spawnSync(process.execPath, [path.join(__dirname, 'upload_banks.js')], { stdio: 'inherit' });
if (upload.status !== 0) { console.error('✗ Falló la subida de bancos.'); process.exit(upload.status || 1); }

console.log('\n── 2/2 · Desplegando las Edge Functions (login, get-bank) ──');

function deployFunction(fn) {
    const args = ['functions', 'deploy', fn, '--no-verify-jwt', '--project-ref', ref];
    let r = spawnSync('supabase', args, {
        stdio: 'inherit', shell: true,
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN || '' }
    });
    if (r.error || r.status !== 0) {
        console.log('\n· La CLI "supabase" no está disponible; probando con npx…');
        r = spawnSync('npx', ['--yes', 'supabase', ...args], {
            stdio: 'inherit', shell: true,
            env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN || '' }
        });
    }
    return r;
}

let deploy = deployFunction('login');
if (deploy.status === 0) deploy = deployFunction('get-bank');
if (deploy.status === 0) deploy = deployFunction('admin-logs');
if (deploy.status === 0) deploy = deployFunction('sync-progress');

if (deploy.status !== 0) {
    console.error('\n✗ No se pudo desplegar la función.');
    console.error('  Comprueba: supabase login  (o añade SUPABASE_ACCESS_TOKEN al .env)');
    process.exit(deploy.status || 1);
}

console.log('\n✅ Backend listo. Prueba la app: https://senorja.github.io/simulador-oposicion/');
