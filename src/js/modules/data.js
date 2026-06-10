import { state } from './state.js';

/**
 * Fixes broken Spanish characters produced when a Windows-1252/CP-850 file
 * is read as if it were UTF-8 or Latin-1. Applied to all string fields of
 * CSIF data. Does NOT modify the source file.
 */
function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/¾/g, 'ó').replace(/Ó/g, 'Ó')
        .replace(/±/g, 'ñ').replace(/Ñ/g, 'Ñ')
        .replace(/ß/g, 'á').replace(/Á/g, 'Á')
        .replace(/Ý/g, 'í').replace(/Í/g, 'Í')
        .replace(/Ú/g, 'é').replace(/É/g, 'É')
        .replace(/·/g, 'ú').replace(/Ú/g, 'Ú')
        .replace(/ä/g, 'ü')
        .replace(/┐/g, '¿')
        .replace(/┌/g, '¡')
        .replace(/ö/g, 'ö')
        .replace(/Ý/g, 'ï')
        .replace(/â/g, 'à');
}

function fixCsifQuestion(q) {
    const fix = fixEncoding;
    const fixOpts = (opts) => {
        if (!opts) return opts;
        if (Array.isArray(opts)) return opts.map(fix);
        const out = {};
        Object.entries(opts).forEach(([k, v]) => { out[k] = fix(v); });
        return out;
    };
    return {
        ...q,
        tema: fix(q.tema),
        pregunta: fix(q.pregunta),
        opciones: fixOpts(q.opciones),
        correcta: fix(q.correcta),
        origen: q.origen || 'CSIF',
        source: 'CSIF'
    };
}

/**
 * Normalises an Academia-format question (array opciones + respuesta_correcta)
 * into the standard app format (object opciones {a,b,c,d} + correcta letter).
 */
function normalizeAcademiaQuestion(q, source) {
    const letters = ['a', 'b', 'c', 'd'];
    const opcionesObj = {};
    (q.opciones || []).forEach((text, i) => {
        if (letters[i]) opcionesObj[letters[i]] = text;
    });

    // Find which letter corresponds to respuesta_correcta
    const correctIdx = (q.opciones || []).indexOf(q.respuesta_correcta);
    const correcta = correctIdx >= 0 ? letters[correctIdx] : 'a';

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

export async function loadAllData() {
    try {
        console.log("Fetching question data...");

        const bust = `?v=${Date.now()}`;
        const [resMad, resCsif, resAcad1, resAcad2, resAcad3, resAcad4, resAcad5, resAcad8, resAcad9, resAcad10, resCel2024, resCocinero2026, resCel2026, resPinche2026Ord, resPinche2026Extra] = await Promise.all([
            fetch(`data/preguntas.json${bust}`),
            fetch(`data/csif_questions.json${bust}`),
            fetch(`data/academia_tema1.json${bust}`),
            fetch(`data/academia_tema2.json${bust}`),
            fetch(`data/academia_tema3.json${bust}`),
            fetch(`data/academia_tema4.json${bust}`),
            fetch(`data/academia_tema5.json${bust}`),
            fetch(`data/academia_tema8.json${bust}`),
            fetch(`data/academia_tema9.json${bust}`),
            fetch(`data/academia_tema10.json${bust}`),
            fetch(`data/sescam_2024_celador.json${bust}`),
            fetch(`data/sescam_2026_cocinero.json${bust}`),
            fetch(`data/sescam_2026_celador.json${bust}`),
            fetch(`data/sescam_2026_pinche_ord.json${bust}`),
            fetch(`data/sescam_2026_pinche_extra.json${bust}`)
        ]);

        if (!resMad.ok) throw new Error(`HTTP ${resMad.status} al cargar preguntas.json`);

        const textMad = await resMad.text();
        const textCsif = resCsif.ok ? await resCsif.text() : '[]';
        const textAcad1 = resAcad1.ok ? await resAcad1.text() : '[]';
        const textAcad2 = resAcad2.ok ? await resAcad2.text() : '[]';
        const textAcad3 = resAcad3.ok ? await resAcad3.text() : '[]';
        const textAcad4 = resAcad4.ok ? await resAcad4.text() : '[]';
        const textAcad5 = resAcad5.ok ? await resAcad5.text() : '[]';
        const textAcad8 = resAcad8.ok ? await resAcad8.text() : '[]';
        const textAcad9 = resAcad9.ok ? await resAcad9.text() : '[]';
        const textAcad10 = resAcad10.ok ? await resAcad10.text() : '[]';
        const textCel2024 = resCel2024.ok ? await resCel2024.text() : '[]';
        const textCocinero2026 = resCocinero2026.ok ? await resCocinero2026.text() : '[]';
        const textCel2026 = resCel2026.ok ? await resCel2026.text() : '[]';
        const textPinche2026Ord = resPinche2026Ord.ok ? await resPinche2026Ord.text() : '[]';
        const textPinche2026Extra = resPinche2026Extra.ok ? await resPinche2026Extra.text() : '[]';

        // Sanitize BOM (Byte Order Mark) that corrupts JSON.parse()
        const sanitize = (str) => str.replace(/^\uFEFF/, '').trim();

        const madData = JSON.parse(sanitize(textMad));
        const csifData = JSON.parse(sanitize(textCsif));
        const acadData1 = JSON.parse(sanitize(textAcad1));
        const acadData2 = JSON.parse(sanitize(textAcad2));
        const acadData3 = JSON.parse(sanitize(textAcad3));
        const acadData4 = JSON.parse(sanitize(textAcad4));
        const acadData5 = JSON.parse(sanitize(textAcad5));
        const acadData8 = JSON.parse(sanitize(textAcad8));
        const acadData9 = JSON.parse(sanitize(textAcad9));
        const acadData10 = JSON.parse(sanitize(textAcad10));
        const cel2024Data = JSON.parse(sanitize(textCel2024));
        const cocinero2026Data = JSON.parse(sanitize(textCocinero2026));
        const cel2026Data = JSON.parse(sanitize(textCel2026));
        const pinche2026OrdData = JSON.parse(sanitize(textPinche2026Ord));
        const pinche2026ExtraData = JSON.parse(sanitize(textPinche2026Extra));

        // Tag standard format sources
        const madWithSource = madData.map(q => ({ ...q, source: q.origen || 'MAD', origen: q.origen || 'MAD' }));
        const csifWithSource = csifData.map(q => fixCsifQuestion(q));

        // Normalize Academia format (array opciones → object, respuesta_correcta → correcta)
        const acadNormalized = [
            ...acadData1.map(q => normalizeAcademiaQuestion(q, 'Academia')),
            ...acadData2.map(q => normalizeAcademiaQuestion(q, 'Academia')),
            ...acadData3.map(q => normalizeAcademiaQuestion(q, 'Academia')),
            ...acadData4.map(q => normalizeAcademiaQuestion(q, 'Academia')),
            ...acadData5.map(q => normalizeAcademiaQuestion(q, 'Academia')),
            ...acadData8.map(q => normalizeAcademiaQuestion(q, 'Academia')),
            ...acadData9.map(q => normalizeAcademiaQuestion(q, 'Academia')),
            ...acadData10.map(q => normalizeAcademiaQuestion(q, 'Academia'))
        ];

        const cel2024WithSource = cel2024Data.map(q => ({ ...q, source: 'Histo', origen: 'Examen Oficial Celador 2024' }));
        const cocinero2026WithSource = cocinero2026Data.map(q => ({ ...q, source: 'Histo', origen: 'OPE SESCAM Cocinero 2026' }));
        const cel2026WithSource = cel2026Data.map(q => ({ ...q, source: 'Histo', origen: 'OPE SESCAM Celador 2026' }));
        const pinche2026OrdWithSource = pinche2026OrdData.map(q => ({ ...q, source: 'Histo', origen: 'OPE SESCAM Pinche Ordinario 2026' }));
        const pinche2026ExtraWithSource = pinche2026ExtraData.map(q => ({ ...q, source: 'Histo', origen: 'OPE SESCAM Pinche Extraordinario 2026' }));

        state.allQuestions = [...madWithSource, ...csifWithSource, ...acadNormalized, ...cel2024WithSource, ...cocinero2026WithSource, ...cel2026WithSource, ...pinche2026OrdWithSource, ...pinche2026ExtraWithSource];
        console.log(`Loaded ${state.allQuestions.length} questions. (MAD: ${madWithSource.length}, CSIF: ${csifWithSource.length}, Academia: ${acadNormalized.length}, Celador 2024: ${cel2024WithSource.length}, Cocinero 2026: ${cocinero2026WithSource.length}, Celador 2026: ${cel2026WithSource.length}, Pinche Ordinario 2026: ${pinche2026OrdWithSource.length}, Pinche Extraordinario 2026: ${pinche2026ExtraWithSource.length})`);
        return state.allQuestions;

    } catch (err) {
        console.error("CRITICAL: Error loading questions:", err);
        const msg = document.getElementById('access-msg');
        if (msg) msg.innerText = `⚠️ Error al cargar datos: ${err.message}`;
        return [];
    }
}
