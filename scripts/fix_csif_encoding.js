/**
 * fix_csif_encoding.js
 * ------------------------------------------------------------------
 * Repara EN DISCO el mojibake de data/csif_questions.json
 * (archivo grabado en CP850/Windows-1252 leido como Latin-1).
 *
 * Antes el arreglo se hacia en tiempo de ejecucion (fixEncoding en
 * data.js); al corregir el archivo fuente, ese parche ya no es
 * necesario y se elimina del runtime.
 *
 * Mapa aplicado (verificado caracter a caracter contra el archivo):
 *   ¾→ó  ±→ñ  ß→á  Ý→í  Ú→é  ·→ú  ┐→¿  ┌→¡
 *
 * Uso:  node scripts/fix_csif_encoding.js --check   (solo muestra muestras)
 *       node scripts/fix_csif_encoding.js           (escribe el archivo)
 * ------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'csif_questions.json');
const CHECK_ONLY = process.argv.includes('--check');

const raw = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(raw.replace(/^﻿/, ''));

function fix(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/¾/g, 'ó')
        .replace(/±/g, 'ñ')
        .replace(/ß/g, 'á')
        .replace(/Ý/g, 'í')
        .replace(/Ú/g, 'é')
        .replace(/·/g, 'ú')
        .replace(/┐/g, '¿')
        .replace(/┌/g, '¡');
}

const fixed = data.map(q => ({
    ...q,
    tema: fix(q.tema),
    pregunta: fix(q.pregunta),
    opciones: Array.isArray(q.opciones)
        ? q.opciones.map(fix)
        : Object.fromEntries(Object.entries(q.opciones || {}).map(([k, v]) => [k, fix(v)])),
    correcta: fix(q.correcta),
    explicacion: fix(q.explicacion)
}));

// Muestras de control
console.log('--- Muestras tras la correccion ---');
fixed.slice(0, 3).forEach(q => console.log(' •', q.pregunta.substring(0, 90)));
const g = fixed.find(q => /Género|género/.test(q.pregunta) || /Género|género/.test(JSON.stringify(q.opciones)));
console.log(' • Control "género":', g ? 'OK' : '(no encontrado en muestra)');

// Verificar que no quedan caracteres mojibake
const json = JSON.stringify(fixed);
const restantes = ['¾', '±', 'ß', 'Ý', 'Ú', '·', '┐', '┌'].filter(c => json.includes(c));
console.log('Caracteres mojibake restantes:', restantes.length ? restantes.join(' ') : 'ninguno');
// Verificar integridad: mismo numero de preguntas y mismos ids
const idsOk = fixed.every((q, i) => q.id === data[i].id);
console.log('Integridad (mismo orden/ids):', idsOk ? 'OK' : '❌ ERROR');
if (!idsOk || restantes.length > 0) process.exit(1);

if (CHECK_ONLY) {
    console.log('✅ Modo --check: conversion correcta. No se ha escrito nada.');
    process.exit(0);
}

const hasBOM = raw.charCodeAt(0) === 0xFEFF;
const out = JSON.stringify(fixed, null, 2).replace(/\n/g, raw.includes('\r\n') ? '\r\n' : '\n');
fs.writeFileSync(FILE, (hasBOM ? '﻿' : '') + out, 'utf8');
console.log('✅ data/csif_questions.json reescrito en UTF-8 correcto (' + fixed.length + ' preguntas).');
