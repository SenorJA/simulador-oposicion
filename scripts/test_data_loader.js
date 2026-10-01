/**
 * test_data_loader.js — Ejecuta el data.js REAL contra los ficheros de disco y
 * comprueba que produce EXACTAMENTE el mismo dataset que antes del refactor.
 *
 * Mockea solo `fetch` (leyendo de data/) y el DOM mínimo que usa el aviso.
 *
 * Uso: node scripts/test_data_loader.js
 */
const fs = require('fs');
const path = require('path');
// Re-lanza con --experimental-vm-modules si esta versión de Node lo exige
const vm = require('./vm-bootstrap.js');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

let fails = 0;
const ok = (c, msg, extra = '') => {
    console.log((c ? '  ✅ ' : '  ❌ ') + msg + (extra ? ' → ' + extra : ''));
    if (!c) fails++;
};

// ── fetch falso: lee de data/, y puede simular fallos ──────────────────────
const fetchLog = [];
let failFiles = new Set();     // ficheros que deben simular error
let corruptFiles = new Set();  // ficheros que deben devolver basura truncada

function makeFetch() {
    return async (url) => {
        const file = url.replace(/^data\//, '').split('?')[0];
        fetchLog.push(url);
        if (failFiles.has(file)) {
            return { ok: false, status: 404, text: async () => 'Not Found' };
        }
        if (corruptFiles.has(file)) {
            return { ok: true, status: 200, text: async () => '[{"id":"x","preg' };
        }
        const p = path.join(ROOT, 'data', file);
        if (!fs.existsSync(p)) return { ok: false, status: 404, text: async () => '' };
        return { ok: true, status: 200, text: async () => fs.readFileSync(p, 'utf8') };
    };
}

// ── DOM mínimo ─────────────────────────────────────────────────────────────
const warning = { classList: { _h: new Set(), add(c) { this._h.add(c); }, remove(c) { this._h.delete(c); }, contains(c) { return this._h.has(c); } }, innerHTML: '', hidden: false };
const document = { getElementById: (id) => (id === 'data-warning' ? warning : null) };

async function loadDataModule() {
    const state = { allQuestions: [] };
    const ctx = vm.createContext({
        console, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise, Math, parseInt,
        document, fetch: makeFetch(),
        state,
        CONFIG: { APP_VERSION: 'v1.16.5' }
    });
    const read = (f) => new vm.SourceTextModule(
        fs.readFileSync(path.join(ROOT, f), 'utf8'),
        { identifier: f, initializeImportMeta: (m) => { m.export = null; }, context: ctx }
    );
    const stateMod = read('src/js/modules/state.js');
    const cfgMod = read('src/js/modules/config.js');
    const dataMod = read('src/js/modules/data.js');
    await dataMod.link((dep) => {
        if (dep === './state.js') return stateMod;
        if (dep === './config.js') return cfgMod;
        throw new Error('import inesperado: ' + dep);
    });
    await dataMod.evaluate();
    return {
        loadAllData: dataMod.namespace.loadAllData,
        getLastLoadReport: dataMod.namespace.getLastLoadReport,
        state: stateMod.namespace.state
    };
}

const fingerprint = (list) => crypto.createHash('sha256').update(
    list.map(q => JSON.stringify({
        id: q.id, tema: q.tema, pregunta: q.pregunta,
        opciones: q.opciones, correcta: q.correcta, origen: q.origen, source: q.source
    })).join('\n')
).digest('hex');

async function main() {
    console.log('=== 1. Carga correcta: 17 bancos ===');
    const { loadAllData, state } = await loadDataModule();
    const qs = await loadAllData();
    ok(qs.length === 5245, 'carga 5.245 preguntas', String(qs.length));
    ok(state.allQuestions === qs, 'expone el dataset en state.allQuestions');
    ok(fetchLog.length === 17, 'descarga los 17 bancos', String(fetchLog.length));
    ok(warning.classList.contains('hidden'), 'sin aviso con todos los bancos OK');

    console.log('\n=== 2. El dataset es IDÉNTICO al de antes del refactor ===');
    const EXPECTED = '86ffee99a497156ad4840e21563b2a9864e8ac162c7ed34f4040e582f753a310';
    const fp = fingerprint(qs);
    ok(fp === EXPECTED, 'sha256 coincide con la huella previa', fp.slice(0, 24) + '…');

    console.log('\n=== 3. Origenes de cada examen (los usan los botones del menú) ===');
    const esperados = {
        'OPE SESCAM Pinche Ordinario 2026': 65,
        'OPE SESCAM Pinche Extraordinario 2026': 65,
        'OPE SESCAM Cocinero 2026': 82,
        'OPE SESCAM Celador 2026': 65,
        'Examen Oficial Celador/a Extraordinario SESCAM 2026': 65,
        'Examen Oficial Técnico de Gestión de TI SESCAM 2026': 100,
        'Examen Oficial Celador 2024': 100,
        'OPE SESCAM Celador 2026 ': 0
    };
    const porOrigen = qs.reduce((a, q) => { a[q.origen] = (a[q.origen] || 0) + 1; return a; }, {});
    for (const [k, v] of Object.entries(esperados)) {
        if (v === 0) continue;
        ok(porOrigen[k] === v, `"${k}" → ${v}`, String(porOrigen[k]));
    }

    console.log('\n=== 4. Caché por release, no por visita (punto D) ===');
    const conFecha = fetchLog.filter(u => /v=\d{10,}/.test(u));
    ok(conFecha.length === 0, 'ningún fetch usa marca de tiempo', conFecha[0] || '');
    ok(fetchLog.every(u => u.endsWith('?v=v1.16.5')), 'todos usan ?v=CONFIG.APP_VERSION', fetchLog[0]);

    console.log('\n=== 5. Un banco caído se AVISA, no se pierde en silencio (punto A) ===');
    failFiles = new Set(['sescam_2026_tecnico_ti.json']);
    warning.classList.add('hidden'); warning.innerHTML = '';
    const { loadAllData: load2 } = await loadDataModule();
    const qs2 = await load2();
    ok(qs2.length === 5145, 'carga el resto sin el banco caído (5245-100)', String(qs2.length));
    ok(!warning.classList.contains('hidden'), 'muestra el aviso visible');
    ok(/sescam_2026_tecnico_ti\.json/.test(warning.innerHTML), 'el aviso nombra el fichero que falta');
    ok(/HTTP 404/.test(warning.innerHTML), 'el aviso indica el motivo');
    failFiles = new Set();

    console.log('\n=== 6. JSON truncado (corte de red a medias) ===');
    corruptFiles = new Set(['academia_tema3.json']);
    warning.classList.add('hidden'); warning.innerHTML = '';
    const { loadAllData: load3 } = await loadDataModule();
    const qs3 = await load3();
    ok(qs3.length === 5245 - 75, 'el banco corrupto se descarta entero (75 preguntas)', String(qs3.length));
    ok(/academia_tema3\.json/.test(warning.innerHTML), 'el aviso nombra el fichero corrupto');
    corruptFiles = new Set();

    console.log('\n=== 7. Validación de preguntas inválidas (punto B) ===');
    // Inyecta preguntas rotas en un banco real, usando SU formato (Academia:
    // opciones es un array y la correcta se llama respuesta_correcta)
    const bad = path.join(ROOT, 'data', 'academia_tema9.json');
    const original = fs.readFileSync(bad, 'utf8');
    const parsed = JSON.parse(original.replace(/^﻿/, ''));
    const existingId = parsed[0].id;
    parsed.push(
        { id: 'ROTA_correcta_inexistente', tema: 'Tema 9', pregunta: 'P', opciones: ['A', 'B', 'C'], respuesta_correcta: 'Z' },
        { id: existingId, tema: 'Tema 9', pregunta: 'Duplicada', opciones: ['A', 'B', 'C'], respuesta_correcta: 'A' },
        { id: 'ROTA_sin_opciones', tema: 'Tema 9', pregunta: 'P', respuesta_correcta: 'A' },
        { id: 'ROTA_una_sola_opcion', tema: 'Tema 9', pregunta: 'P', opciones: ['Única'], respuesta_correcta: 'Única' },
        { id: 'ROTA_pregunta_vacia', tema: 'Tema 9', pregunta: '   ', opciones: ['A', 'B'], respuesta_correcta: 'A' }
    );
    fs.writeFileSync(bad, JSON.stringify(parsed, null, 2), 'utf8');
    try {
        warning.classList.add('hidden'); warning.innerHTML = '';
        const { loadAllData: load4, getLastLoadReport: report4 } = await loadDataModule();
        const qs4 = await load4();
        const rep = report4();
        const todo = rep.invalidDetails.join('\n');
        ok(qs4.length === 5245, 'descarta las 5 inválidas y conserva el resto', String(qs4.length));
        ok(/sin coincidencia con las opciones/.test(todo), 'detecta respuesta_correcta sin coincidencia');
        ok(/repetido en otro banco/.test(todo), 'detecta id duplicado');
        ok(/solo 0 opción\(es\)/.test(todo), 'detecta opciones ausentes');
        ok(/solo 1 opción\(es\)/.test(todo), 'detecta menos de 2 opciones');
        ok(/"pregunta" vacía/.test(todo), 'detecta pregunta vacía');
        ok(rep.invalidDetails.length === 5, 'informa de las 5 en el informe completo', String(rep.invalidDetails.length));
        ok(warning.innerHTML.includes('Preguntas descartadas (5)'), 'el aviso visible resume la cantidad');
        ok(!qs4.some(q => String(q.id).startsWith('ROTA_')), 'ninguna pregunta rota llega a la app');
    } finally {
        fs.writeFileSync(bad, original, 'utf8'); // restaurar
    }

    console.log('\n' + (fails === 0 ? '✅ CARGADOR ROBUSTO Y EQUIVALENTE AL ANTERIOR' : `❌ ${fails} FALLOS`));
    process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error('Error en la prueba:', e); process.exit(1); });
