/**
 * data.js — Carga y normaliza los bancos de preguntas.
 *
 * Añadir un examen nuevo = añadir UNA línea al array BANKS de este archivo.
 * (Antes había que editar 5 sitios: fetch, texto, JSON.parse, normalizar y log.)
 */
import { state } from './state.js';
import { CONFIG } from './config.js';
import * as Storage from './storage.js';

// ── Registro de bancos ─────────────────────────────────────────────────────
// kind:
//   'raw'      → ya viene normalizado; usa su propio q.origen (MAD)
//   'csif'     → se etiqueta como CSIF
//   'academia' → opciones es un ARRAY y la correcta es respuesta_correcta
//   'historo'  → se etiqueta como histórico con el origen exacto del examen
// ⚠️ El campo `origen` es la clave con la que main.js y topics.js localizan cada
//    examen. Si lo cambias, el botón del menú deja de encontrar sus preguntas.
const BANKS = [
    { file: 'preguntas.json', kind: 'raw', origen: null },

    { file: 'csif_questions.json', kind: 'csif', origen: 'CSIF' },

    { file: 'academia_tema1.json', kind: 'academia', origen: 'Academia' },
    { file: 'academia_tema2.json', kind: 'academia', origen: 'Academia' },
    { file: 'academia_tema3.json', kind: 'academia', origen: 'Academia' },
    { file: 'academia_tema4.json', kind: 'academia', origen: 'Academia' },
    { file: 'academia_tema5.json', kind: 'academia', origen: 'Academia' },
    { file: 'academia_tema8.json', kind: 'academia', origen: 'Academia' },
    { file: 'academia_tema9.json', kind: 'academia', origen: 'Academia' },
    { file: 'academia_tema10.json', kind: 'academia', origen: 'Academia' },

    { file: 'sescam_2024_celador.json', kind: 'historo', origen: 'Examen Oficial Celador 2024' },
    { file: 'sescam_2026_cocinero.json', kind: 'historo', origen: 'OPE SESCAM Cocinero 2026' },
    { file: 'sescam_2026_celador.json', kind: 'historo', origen: 'OPE SESCAM Celador 2026' },
    { file: 'sescam_2026_pinche_ord.json', kind: 'historo', origen: 'OPE SESCAM Pinche Ordinario 2026' },
    { file: 'sescam_2026_pinche_extra.json', kind: 'historo', origen: 'OPE SESCAM Pinche Extraordinario 2026' },
    { file: 'sescam_2026_celador_extra.json', kind: 'historo', origen: 'Examen Oficial Celador/a Extraordinario SESCAM 2026' },
    { file: 'sescam_2026_tecnico_ti.json', kind: 'historo', origen: 'Examen Oficial Técnico de Gestión de TI SESCAM 2026' }
];

/** Convierte el formato de Academia (opciones array + respuesta_correcta) al común. */
function normalizeAcademiaQuestion(q, source) {
    const letters = ['a', 'b', 'c', 'd'];
    const opcionesObj = {};
    // Una pregunta corrupta puede traer 'opciones' como objeto o como texto:
    // nunca debe romper la normalización, la validar y descartarla después.
    const crudas = Array.isArray(q.opciones) ? q.opciones : [];
    crudas.forEach((text, i) => {
        if (letters[i]) opcionesObj[letters[i]] = text;
    });

    // La letra correcta es la posición de la respuesta dentro del array.
    // Si `respuesta_correcta` no encaja con ninguna opción, NO se elige 'a' por
    // defecto: se deja en null para que la validación la descarte y se avise.
    // Adivinar la respuesta convertiría en silencio una pregunta malIndexerada.
    const correctIdx = crudas.indexOf(q.respuesta_correcta);
    const correcta = correctIdx >= 0 ? letters[correctIdx] : null;

    return {
        id: q.id,
        tema: q.tema,
        pregunta: q.pregunta,
        opciones: opcionesObj,
        correcta,
        origen: source,
        source
    };
}

/** Aplica el etiquetado de origen/source según el tipo de banco. */
function tagQuestion(q, bank) {
    switch (bank.kind) {
        case 'raw':
            return { ...q, source: q.origen || 'MAD', origen: q.origen || 'MAD' };
        case 'csif':
            return { ...q, origen: q.origen || bank.origen, source: bank.origen };
        case 'academia':
            return normalizeAcademiaQuestion(q, bank.origen);
        case 'historo':
            return { ...q, source: 'Histo', origen: bank.origen };
        default:
            return q;
    }
}

/**
 * Valida una pregunta ya normalizada.
 * @returns {string|null} Descripción del problema, o null si está bien.
 */
function validateQuestion(q, file, index) {
    const where = `${file}[${index}] id=${q?.id ?? '(sin id)'}`;

    if (!q || typeof q !== 'object') return `${where}: no es un objeto`;
    if (!q.id || typeof q.id !== 'string') return `${where}: falta "id" o no es texto`;
    if (!q.pregunta || !String(q.pregunta).trim()) return `${where}: "pregunta" vacía`;
    if (!q.opciones || typeof q.opciones !== 'object' || Array.isArray(q.opciones)) {
        return `${where}: "opciones" debe ser un objeto {a,b,c,d}`;
    }

    const validas = Object.keys(q.opciones).filter(k => q.opciones[k] && String(q.opciones[k]).trim());
    if (validas.length < 2) return `${where}: solo ${validas.length} opción(es) con texto`;

    const correctas = Array.isArray(q.correcta) ? q.correcta : [q.correcta];
    if (correctas.length === 0 || correctas.some(c => c === undefined || c === null)) {
        return `${where}: "correcta" vacía o sin coincidencia con las opciones`;
    }
    for (const c of correctas) {
        if (!(c in q.opciones)) return `${where}: "correcta" = "${c}" no existe en "opciones"`;
    }
    return null;
}

const ESPERA_REINTENTO_MS = 700;
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

/** Fallos que merece la pena reintentar (red o servidor), no 4xx de negocio. */
const esTransitorio = (status) => status === 429 || status >= 500;

/**
 * Descarga un banco desde la Edge Function `get-bank`, que valida la licencia
 * server-side y sirve el JSON de un bucket PRIVADO. Reintenta UNA vez ante un
 * fallo transitorio (corte de red o 5xx); ante un 403/404 o datos corruptos no
 * insiste, porque reintentar no lo arreglaría.
 * NUNCA lanza: devuelve el error para poder informarlo.
 */
async function fetchBank(bank, intento = 0) {
    const token = Storage.getToken();
    if (!token) return { bank, ok: false, error: 'sin sesión' };

    let res;
    try {
        res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/get-bank`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: CONFIG.SUPABASE_KEY,
                Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`
            },
            body: JSON.stringify({ bank: bank.file, token })
        });
    } catch (e) {
        if (intento === 0) {
            await esperar(ESPERA_REINTENTO_MS);
            return fetchBank(bank, 1);
        }
        return { bank, ok: false, error: e.message };
    }

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const err = await res.json();
            if (err && err.error) msg = err.error;
        } catch { /* respuesta sin JSON */ }

        if (esTransitorio(res.status) && intento === 0) {
            await esperar(ESPERA_REINTENTO_MS);
            return fetchBank(bank, 1);
        }
        return { bank, ok: false, error: msg };
    }

    try {
        const data = await res.json();
        if (!Array.isArray(data)) return { bank, ok: false, error: 'la respuesta no es un array' };
        return { bank, ok: true, data };
    } catch (e) {
        return { bank, ok: false, error: e.message }; // dato corrupto: no se reintenta
    }
}

const MAX_DETALLES_EN_AVISO = 5;

/** Muestra un aviso visible si algún banco no cargó o alguna pregunta es inválida. */
function showDataWarning(bankErrors, invalidDetails) {
    const box = document.getElementById('data-warning');
    if (!box) return;

    const totalInvalid = invalidDetails.length;
    if (!bankErrors.length && !totalInvalid) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }

    const parts = [];
    if (bankErrors.length) parts.push(`<li><strong>Bancos no cargados:</strong> ${bankErrors.join(', ')}</li>`);
    if (totalInvalid) {
        // Se muestran los primeros para que el aviso siga siendo legible; el resto va a la consola
        const muestra = invalidDetails.slice(0, MAX_DETALLES_EN_AVISO);
        const resto = totalInvalid - muestra.length;
        parts.push(`<li><strong>Preguntas descartadas (${totalInvalid}):</strong>
            <ul>${muestra.map(p => `<li>${p}</li>`).join('')}${resto > 0 ? `<li>… y ${resto} más</li>` : ''}</ul>
        </li>`);
    }

    box.innerHTML = `
        <strong>⚠️ Carga de datos incompleta.</strong>
        <ul>${parts.join('')}</ul>
        <small>Si falta un temario, recarga con Ctrl+F5. El detalle completo está en la consola (F12).</small>
    `;
    box.classList.remove('hidden');
}

// Informe de la última carga, para diagnóstico (consola, pruebas o panel admin)
let lastLoadReport = { total: 0, banks: 0, bankErrors: [], invalidDetails: [] };
export function getLastLoadReport() {
    return lastLoadReport;
}

export async function loadAllData() {
    console.log('[DATA] Cargando bancos de preguntas vía get-bank…');
    const results = await Promise.all(BANKS.map(b => fetchBank(b)));

    const bankErrors = [];
    const invalidDetails = [];
    const allIds = new Set();          // unicidad global entre archivos
    const questions = [];
    const perBank = [];

    for (const r of results) {
        const file = r.bank.file;

        if (!r.ok) {
            bankErrors.push(`${file} (${r.error})`);
            perBank.push([file, 0]);
            console.error(`[DATA] ✗ ${file}: ${r.error}`);
            continue;
        }

        const kept = [];
        r.data.forEach((q, i) => {
            let tagged = null;
            try {
                tagged = tagQuestion(q, r.bank);
            } catch (e) {
                // Red de seguridad: ni una pregunta corrupta puede tumbar la carga
                invalidDetails.push(`${file}[${i}]: no se pudo normalizar (${e.message})`);
                return;
            }

            const problem = validateQuestion(tagged, file, i);
            if (problem) { invalidDetails.push(problem); return; }

            if (allIds.has(tagged.id)) {
                invalidDetails.push(`${file}[${i}]: id "${tagged.id}" repetido en otro banco`);
                return;
            }
            allIds.add(tagged.id);
            kept.push(tagged);
        });

        perBank.push([file, kept.length]);
        questions.push(...kept);

        if (kept.length !== r.data.length) {
            console.warn(`[DATA] ⚠ ${file}: ${r.data.length - kept.length} pregunta(s) descartada(s)`);
        }
    }

    state.allQuestions = questions;

    if (bankErrors.length || invalidDetails.length) {
        console.error('[DATA] Problemas detectados:', { bankErrors, invalidDetails });
        invalidDetails.slice(0, 20).forEach(p => console.warn('   ·', p));
        if (invalidDetails.length > 20) console.warn(`   … y ${invalidDetails.length - 20} más`);
    }

    showDataWarning(bankErrors, invalidDetails);
    lastLoadReport = {
        total: questions.length,
        banks: results.length - bankErrors.length,
        bankErrors,
        invalidDetails
    };

    const resumen = perBank.map(([f, n]) => `${f.replace('.json', '')}: ${n}`).join(', ');
    console.log(`[DATA] ${questions.length} preguntas cargadas → ${resumen}`);

    return questions;
}
