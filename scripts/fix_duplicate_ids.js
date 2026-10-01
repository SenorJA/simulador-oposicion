/**
 * fix_duplicate_ids.js
 * ------------------------------------------------------------------
 * Repara los IDs duplicados de data/preguntas.json (Temas 11-16 de MAD,
 * que usaban IDs numericos reiniciados en cada tema: 1, 2, 3...).
 *
 * Estrategia (sumativa, no borra ni reordena preguntas):
 *   - Toda pregunta con tema exacto "Tema 11".."Tema 16" e id numerico
 *     pasa a id string "mad_t{N}_{idAntiguo}".
 *   - Si dentro del mismo tema un id aparece repetido, la 2a+ ocurrencia
 *     recibe sufijo "_b", "_c", ...
 *   - Al final se verifica la unicidad GLOBAL de todos los ids.
 *
 * Uso:  node scripts/fix_duplicate_ids.js          (aplica los cambios)
 *       node scripts/fix_duplicate_ids.js --check  (solo simula, no escribe)
 * ------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'preguntas.json');
const CHECK_ONLY = process.argv.includes('--check');

const raw = fs.readFileSync(FILE, 'utf8');
const hasBOM = raw.charCodeAt(0) === 0xFEFF;
const data = JSON.parse(raw.replace(/^﻿/, ''));

const temaRe = /^Tema (1[1-6])$/;
let renombrados = 0;
const porTemaCount = {}; // control de repetidos dentro del propio tema

const out = data.map(q => {
    const m = q.tema && q.tema.match(temaRe);
    if (!m || typeof q.id !== 'number') return q;

    const temaN = m[1];
    const base = `mad_t${temaN}_${q.id}`;
    porTemaCount[base] = (porTemaCount[base] || 0) + 1;
    // Sufijo solo si el id se repite dentro del mismo tema (caso real: Tema 11, id 155)
    const sufijo = porTemaCount[base] > 1 ? '_' + String.fromCharCode(96 + porTemaCount[base]) : '';

    renombrados++;
    return { ...q, id: base + sufijo };
});

// ── Verificación de unicidad global ─────────────────────────────────────────
const seen = new Set();
const dupes = [];
out.forEach(q => {
    if (seen.has(q.id)) dupes.push(q.id);
    seen.add(q.id);
});

console.log(`Preguntas totales:      ${out.length}`);
console.log(`IDs renombrados:        ${renombrados}`);
console.log(`IDs unicos tras el fix: ${seen.size}`);
if (dupes.length > 0) {
    console.error('❌ SIGUEN HABIEDO DUPLICADOS:', dupes.slice(0, 10));
    process.exit(1);
}

if (CHECK_ONLY) {
    console.log('✅ Modo --check: duplicados resueltos correctamente. No se ha escrito nada.');
    process.exit(0);
}

// Escribir conservando BOM (si lo tenia) y terminaciones CRLF del original
const json = JSON.stringify(out, null, 2).replace(/\n/g, '\r\n');
fs.writeFileSync(FILE, (hasBOM ? '﻿' : '') + json, 'utf8');
console.log('✅ data/preguntas.json actualizado. IDs unicos garantizados.');
