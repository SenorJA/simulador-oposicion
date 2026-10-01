/**
 * verify_refs.js — Comprobaciones estáticas de referencias y datos.
 * Uso: node scripts/verify_refs.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const r = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const jsFiles = ['src/js/main.js', ...fs.readdirSync(path.join(ROOT, 'src/js/modules')).map(f => 'src/js/modules/' + f)];
const html = r('index.html');
const css = r('css/style-v31.css');

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✅ ' : '  ❌ ') + msg); if (!c) fails++; };

console.log('=== 1. Exports de storage.js realmente usados ===');
const st = [...r('src/js/modules/storage.js').matchAll(/export (?:async )?function (\w+)/g)].map(m => m[1]);
const consumers = jsFiles.filter(f => !f.endsWith('storage.js')).map(f => r(f)).join('\n');
const unused = st.filter(n => !new RegExp('Storage\\.' + n + '\\b').test(consumers));
ok(unused.length === 0, 'sin exports muertos' + (unused.length ? ': ' + unused.join(', ') : ''));

console.log('=== 2. IDs usados por getElementById existen en el HTML ===');
// btn-continue-session se crea dinámicamente en main.js (checkAndInjectSessionButton)
const dynamicIds = new Set(['btn-continue-session']);
const usedIds = [...new Set([...jsFiles.map(f => r(f)).join('\n').matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]))].sort();
const missingInHtml = usedIds.filter(id => !html.includes(`id="${id}"`) && !dynamicIds.has(id));
ok(missingInHtml.length === 0, 'todo getElementById tiene su elemento' + (missingInHtml.length ? ': ' + missingInHtml.join(', ') : ''));

console.log('=== 3. IDs del HTML sin uso en JS ===');
const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const allJs = jsFiles.map(f => r(f)).join('\n');
// Contenedores puramente decorativos: sus hijos sí se usan
const decorative = new Set(['resultado-motivacional']);
// IDs referenciados desde el propio HTML (aria-labelledby, aria-describedby, label for)
const ariaRefs = new Set();
for (const m of html.matchAll(/(?:aria-labelledby|aria-describedby|for)="([^"]+)"/g)) {
    m[1].split(/\s+/).forEach(x => x && ariaRefs.add(x));
}
const unusedHtml = htmlIds.filter(id =>
    !allJs.includes(`'${id}'`) && !allJs.includes(`"${id}"`) && !allJs.includes('#' + id) &&
    !decorative.has(id) && !ariaRefs.has(id));
ok(unusedHtml.length === 0, 'sin elementos huérfanos' + (unusedHtml.length ? ': ' + unusedHtml.join(', ') : ''));

console.log('=== 4. Referencias a archivos inexistentes ===');
const refs = [...html.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)].map(m => m[1].split('?')[0]);
const broken = refs.filter(p => !fs.existsSync(path.join(ROOT, p)));
ok(broken.length === 0, 'sin rutas rotas' + (broken.length ? ': ' + broken.join(', ') : ''));

console.log('=== 5. Imports locales resueltos ===');
const imports = [...allJs.matchAll(/from\s+'(\.[^']+)'/g)].map(m => m[1]);
const brokenImp = [];
for (const f of jsFiles) {
    for (const m of r(f).matchAll(/from\s+'(\.[^']+)'/g)) {
        const target = path.join(path.dirname(path.join(ROOT, f)), m[1]);
        if (!fs.existsSync(target)) brokenImp.push(f + ' -> ' + m[1]);
    }
}
ok(brokenImp.length === 0, 'todos los imports resuelven' + (brokenImp.length ? ': ' + brokenImp.join(', ') : ''));

console.log('=== 6. Prohibición: cache-busting en imports ESM ===');
const bust = [...allJs.matchAll(/from\s+'[^']*\?v=/g)].map(m => m[0]);
ok(bust.length === 0, 'ningún import lleva ?v=' + (bust.length ? ': ' + bust.join(', ') : ''));

console.log('=== 7. Datos: unicidad de IDs y claves ===');
const files = fs.readdirSync(path.join(ROOT, 'data')).filter(f => f.endsWith('.json'));
const seen = new Map();
let dupes = 0, bad = 0;
for (const f of files) {
    const d = JSON.parse(r('data/' + f).replace(/^﻿/, ''));
    if (!Array.isArray(d)) continue;
    for (const q of d) {
        if (q.correcta !== undefined) {
            const letters = Array.isArray(q.correcta) ? q.correcta : [q.correcta];
            for (const L of letters) {
                if (!q.opciones || !(L in q.opciones)) { bad++; console.log(`      correcta inválida ${L} en ${f} (${q.id})`); }
            }
        }
        const k = f + '::' + q.id;
        if (seen.has(k)) { dupes++; if (dupes <= 5) console.log(`      id duplicado: ${k}`); }
        seen.set(k, 1);
    }
}
ok(dupes === 0, 'sin IDs duplicados dentro de cada archivo');
ok(bad === 0, 'todas las respuestas correctas existen en sus opciones');

console.log('=== 8. Unicidad global tras la renumeración ===');
const p = JSON.parse(r('data/preguntas.json').replace(/^﻿/, ''));
const pids = p.map(q => q.id);
ok(new Set(pids).size === pids.length, `preguntas.json: ${pids.length} IDs únicos`);

console.log('=== 9. Mojibake en CSIF ===');
const csif = r('data/csif_questions.json');
const moji = ['¾', '±', 'ß', 'Ý', 'Ú', '·', '┐', '┌'].filter(c => csif.includes(c));
ok(moji.length === 0, 'sin caracteres rotos' + (moji.length ? ': ' + moji.join(' ') : ''));

console.log('=== 10. Versión unificada ===');
const cfg = r('src/js/modules/config.js');
const ver = cfg.match(/APP_VERSION:\s*'([^']+)'/)[1];
ok(html.includes(ver), `index.html refleja APP_VERSION ${ver}`);
ok(!/v1\.15\.7/.test(html), 'sin restos de v1.15.7 en index.html');
ok(!/VALID_HASH/.test(cfg), 'VALID_HASH eliminado de config.js');

console.log('=== 11. Claves de localStorage con prefijo de usuario+rol ===');
const stg = r('src/js/modules/storage.js');
const stgCode = stg.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
ok(/SESSION: 'estado_test_suspendido'/.test(stg) && /pk\(KEYS\.SESSION\)/.test(stgCode), 'sesión suspendida prefijada');
ok(/pk\(KEYS\.RECORDS\)/.test(stgCode) && /key === KEYS\.RECORDS/.test(stgCode), 'récords prefijados');
// El único uso del sufijo '_celador' debe ser la migración desde claves legacy
const legacyUses = stgCode.match(/KEYS\.RECORDS \+ '_celador'/g) || [];
ok(legacyUses.length === 1 && /Migración/.test(stg), 'el sufijo por rol solo queda en la migración legacy');
ok(/getOrCreateDeviceId/.test(stgCode) && !/DeviceRegisteredFor/.test(stg), 'helpers de deviceRegistered muertos eliminados');

console.log('=== 12. Overlays muertos y CryptoJS ===');
ok(!/id="login-overlay"/.test(html), 'id="login-overlay" eliminado del HTML');
ok(!/crypto-js|CryptoJS/.test(html), 'CryptoJS eliminado del HTML');
ok(!/id="login-password"|id="btn-login"|id="login-error"/.test(html), 'controles de contraseña eliminados');
ok(/id="access-retry"/.test(html) && /id="btn-access-retry"/.test(html), 'reintento de acceso presente en el overlay');
ok(/css\/style-v31\.css/.test(html) && !fs.existsSync(path.join(ROOT, 'css/style-v30.css')), 'solo queda style-v31.css');
ok(!fs.existsSync(path.join(ROOT, 'js/script.js')) && !fs.existsSync(path.join(ROOT, 'deploy_test.txt')), 'legacy js/script.js y deploy_test.txt eliminados');

console.log('=== 13. Cargador de datos: registro, validación y origen privado ===');
const data = r('src/js/modules/data.js');
ok(/const BANKS = \[/.test(data), 'los bancos se declaran en el array BANKS');
const bankFiles = [...data.matchAll(/file:\s*'([^']+\.json)'/g)].map(m => m[1]);
ok(bankFiles.length === 17, 'BANKS declara los 17 ficheros', String(bankFiles.length));
// Cada banco debe estar referenciado una sola vez (sin duplicados en el registro)
ok(new Set(bankFiles).size === bankFiles.length, 'sin bancos duplicados en BANKS');
// Los JSON ya no viven en el repo: si están en local, deben coincidir con BANKS
const dataDir = path.join(ROOT, 'data');
if (fs.existsSync(dataDir)) {
    const missingBanks = bankFiles.filter(f => !fs.existsSync(path.join(dataDir, f)));
    ok(missingBanks.length === 0, 'los bancos locales coinciden con BANKS' + (missingBanks.length ? ': ' + missingBanks.join(', ') : ''));
    const onDisk = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort();
    const unregistered = onDisk.filter(f => !bankFiles.includes(f));
    ok(unregistered.length === 0, 'todo JSON local está registrado' + (unregistered.length ? ': ' + unregistered.join(', ') : ''));
} else {
    console.log('  · data/ no está en local (normal en un clon limpio): se omite la comprobación de ficheros');
}
ok(/function validateQuestion/.test(data), 'existe validación de preguntas');
ok(/function getLastLoadReport/.test(data), 'el informe de carga es consultable');
ok(/showDataWarning/.test(data), 'los fallos se muestran en pantalla');
ok(/catch/.test(data), 'un banco corrupto no tumba la carga');
// Los bancos se sirven por la Edge Function, no como fichero estático
ok(/functions\/v1\/get-bank/.test(data), 'data.js pide los bancos a get-bank');
ok(!/fetch\(`data\//.test(data) && !/fetch\('data\//.test(data), 'data.js ya NO lee data/*.json directo');
ok(/Storage\.getSavedUser\(\)/.test(data), 'la licencia se toma del usuario autenticado');
ok(!/^[^/\n]*Date\.now\(\)/m.test(data.replace(/^\s*\/\/.*$/gm, '')), 'sin cache-busting por marca de tiempo');
ok(fs.existsSync(path.join(ROOT, 'supabase/functions/get-bank/index.ts')), 'existe la Edge Function get-bank');
ok(/id="data-warning"/.test(html), 'existe el aviso visible de carga en index.html');
// El aviso debe estar referenciado por el JS
ok(allJs.includes("'data-warning'"), 'data.js rellena el aviso #data-warning');

console.log('=== 14. game.js: estado de vista completa y fallos ===');
const game = r('src/js/modules/game.js');
ok(/function resetFullView\(\)/.test(game) && /resetFullView\(\);\s*\n\s*\n\s*\/\/ ── Auto-limpieza/.test(game), 'startGame resetea la vista completa');
ok(/if \(fallos > 0\)/.test(game), '"Solo Fallos" solo con fallos reales');
ok(/secs % 5 === 0/.test(game), 'la sesión se persiste cada 5 s, no cada tick');

console.log('=== 15. CSS: tokens, duplicados y accesibilidad ===');
// Recorre el CSS llevando la profundidad de llaves para saber el contexto (@media)
// y detectar selectores repetidos en el MISMO contexto.
function analizarCss(texto) {
    const sinComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, '');
    const porContexto = {};
    let profundidad = 0;
    let contexto = '';
    let buffer = '';
    const contextos = [];
    for (let i = 0; i < sinComentarios.length; i++) {
        const c = sinComentarios[i];
        if (c === '{') {
            const preludio = buffer.replace(/\s+/g, ' ').trim();
            contextos[profundidad] = preludio;
            if (preludio.startsWith('@')) {
                contexto = preludio;
            } else if (preludio) {
                (porContexto[contexto] = porContexto[contexto] || []).push(preludio);
            }
            profundidad++;
            buffer = '';
        } else if (c === '}') {
            profundidad--;
            contexto = profundidad > 0 ? (contextos[profundidad - 1] || '') : '';
            if (contexto && !contexto.startsWith('@')) contexto = '';
            buffer = '';
        } else {
            buffer += c;
        }
    }
    return porContexto;
}
const cssTexto = r('css/style-v31.css');
const porContexto = analizarCss(cssTexto);
const duplicados = [];
for (const [ctx, lista] of Object.entries(porContexto)) {
    const cuenta = {};
    lista.forEach(s => { cuenta[s] = (cuenta[s] || 0) + 1; });
    Object.entries(cuenta).filter(([, n]) => n > 1).forEach(([s]) => duplicados.push((ctx ? ctx + ' → ' : '') + s));
}
ok(duplicados.length === 0, 'sin selectores duplicados en el mismo contexto' + (duplicados.length ? ': ' + duplicados.join(' | ') : ''));

const definidas = new Set([...cssTexto.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));
const usadas = new Set([...cssTexto.matchAll(/var\(--([\w-]+)/g)].map(m => m[1]));
const sinDefinir = [...usadas].filter(v => !definidas.has(v));
ok(sinDefinir.length === 0, 'toda var(--x) usada está definida' + (sinDefinir.length ? ': ' + sinDefinir.join(', ') : ''));
const noUsadas = [...definidas].filter(v => !usadas.has(v));
ok(noUsadas.length === 0, 'sin tokens definidos y muertos' + (noUsadas.length ? ': ' + noUsadas.join(', ') : ''));

ok(!/\\n/.test(cssTexto), 'sin la secuencia literal \\n suelta');
ok(!/[ÃÂâ]/.test(cssTexto), 'CSS sin mojibake');
ok(/prefers-reduced-motion/.test(cssTexto), 'respeta prefers-reduced-motion');
ok(/:focus-visible/.test(cssTexto), 'foco visible para teclado');
ok(!/user-select:\s*none/.test(cssTexto), 'no bloquea la selección de texto');
ok(!/ style="/.test(html), 'index.html sin estilos inline');

console.log('\n' + (fails === 0 ? '✅ TODAS LAS COMPROBACIONES OK' : `❌ ${fails} COMPROBACIONES FALLIDAS`));
process.exit(fails ? 1 : 0);
