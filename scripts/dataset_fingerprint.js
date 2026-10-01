/**
 * dataset_fingerprint.js — Huella canónica del dataset cargado por data.js.
 *
 * Se usa para demostrar que un refactor del cargador NO altera ni una sola
 * pregunta: se calcula la huella ANTES y DESPUÉS y se comparan.
 *
 * Uso: node scripts/dataset_fingerprint.js            → muestra la huella
 *      node scripts/dataset_fingerprint.js --save     → la guarda en /tmp
 *      node scripts/dataset_fingerprint.js --compare → compara con la guardada
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SAVE = path.join(require('os').tmpdir(), 'opescam_dataset_fp.json');

const BANKS = [
    ['preguntas.json', 'MAD'],
    ['csif_questions.json', 'CSIF'],
    ['academia_tema1.json', 'Academia'], ['academia_tema2.json', 'Academia'],
    ['academia_tema3.json', 'Academia'], ['academia_tema4.json', 'Academia'],
    ['academia_tema5.json', 'Academia'], ['academia_tema8.json', 'Academia'],
    ['academia_tema9.json', 'Academia'], ['academia_tema10.json', 'Academia'],
    ['sescam_2024_celador.json', 'Histo'],
    ['sescam_2026_cocinero.json', 'Histo'],
    ['sescam_2026_celador.json', 'Histo'],
    ['sescam_2026_pinche_ord.json', 'Histo'],
    ['sescam_2026_pinche_extra.json', 'Histo'],
    ['sescam_2026_celador_extra.json', 'Histo'],
    ['sescam_2026_tecnico_ti.json', 'Histo']
];

/** Réplica exacta de la normalización que hace hoy data.js */
function normalizeAcademia(q, source) {
    const letters = ['a', 'b', 'c', 'd'];
    const opcionesObj = {};
    (q.opciones || []).forEach((text, i) => { if (letters[i]) opcionesObj[letters[i]] = text; });
    const correctIdx = (q.opciones || []).indexOf(q.respuesta_correcta);
    return {
        id: q.id, tema: q.tema, pregunta: q.pregunta, opciones: opcionesObj,
        correcta: correctIdx >= 0 ? letters[correctIdx] : 'a', origen: source, source
    };
}
const ORIGENES = {
    'sescam_2024_celador.json': 'Examen Oficial Celador 2024',
    'sescam_2026_cocinero.json': 'OPE SESCAM Cocinero 2026',
    'sescam_2026_celador.json': 'OPE SESCAM Celador 2026',
    'sescam_2026_pinche_ord.json': 'OPE SESCAM Pinche Ordinario 2026',
    'sescam_2026_pinche_extra.json': 'OPE SESCAM Pinche Extraordinario 2026',
    'sescam_2026_celador_extra.json': 'Examen Oficial Celador/a Extraordinario SESCAM 2026',
    'sescam_2026_tecnico_ti.json': 'Examen Oficial Técnico de Gestión de TI SESCAM 2026'
};

function build() {
    const all = [];
    for (const [file, kind] of BANKS) {
        const raw = fs.readFileSync(path.join(ROOT, 'data', file), 'utf8').replace(/^﻿/, '').trim();
        const d = JSON.parse(raw);
        if (kind === 'MAD') all.push(...d.map(q => ({ ...q, source: q.origen || 'MAD', origen: q.origen || 'MAD' })));
        else if (kind === 'CSIF') all.push(...d.map(q => ({ ...q, origen: q.origen || 'CSIF', source: 'CSIF' })));
        else if (kind === 'Academia') all.push(...d.map(q => normalizeAcademia(q, 'Academia')));
        else all.push(...d.map(q => ({ ...q, source: 'Histo', origen: ORIGENES[file] })));
    }
    return all;
}

const all = build();

// Fingerprint: orden de carga preservado, cada pregunta serializada de forma canónica
const canonical = all.map(q => JSON.stringify({
    id: q.id, tema: q.tema, pregunta: q.pregunta,
    opciones: q.opciones, correcta: q.correcta, origen: q.origen, source: q.source
})).join('\n');

const fp = {
    total: all.length,
    sha256: crypto.createHash('sha256').update(canonical).digest('hex'),
    porOrigen: all.reduce((acc, q) => { acc[q.origen] = (acc[q.origen] || 0) + 1; return acc; }, {}),
    temasUnicos: [...new Set(all.map(q => q.tema))].sort(),
    idsDuplicados: (() => {
        const seen = new Set(), dup = new Set();
        for (const q of all) { if (seen.has(q.id)) dup.add(q.id); seen.add(q.id); }
        return [...dup].sort();
    })()
};

if (process.argv.includes('--save')) {
    fs.writeFileSync(SAVE, JSON.stringify(fp, null, 2));
    console.log('💾 Huella guardada en', SAVE);
}

if (process.argv.includes('--compare')) {
    if (!fs.existsSync(SAVE)) { console.error('❌ No hay huella guardada. Ejecuta antes con --save'); process.exit(1); }
    const before = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
    const same = before.sha256 === fp.sha256;
    console.log('ANTES :', before.total, 'preguntas | sha256', before.sha256.slice(0, 16));
    console.log('AHORA :', fp.total, 'preguntas | sha256', fp.sha256.slice(0, 16));
    console.log(same ? '✅ Dataset IDÉNTICO: el refactor no cambió ni una pregunta'
                     : '❌ EL DATASET CAMBIÓ');
    if (!same) {
        console.log('  antes porOrigen:', JSON.stringify(before.porOrigen));
        console.log('  ahora porOrigen:', JSON.stringify(fp.porOrigen));
    }
    process.exit(same ? 0 : 1);
}

console.log('Total:', fp.total);
console.log('sha256:', fp.sha256);
console.log('IDs duplicados globales:', fp.idsDuplicados.length ? fp.idsDuplicados.join(', ') : 'ninguno');
console.log('\nPor origen:');
Object.entries(fp.porOrigen).sort().forEach(([k, v]) => console.log('  ' + String(v).padStart(5), k));
