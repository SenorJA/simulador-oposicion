import * as Storage from './storage.js';
import { state } from './state.js';

/**
 * ui.js — View navigation and DOM helpers
 * All view IDs must match what exists in index.html.
 */

const VIEW_IDS = {
    roleSelection: 'view-role-selection',
    menu: 'view-menu',
    parts: 'view-parts',
    topics: 'view-topics',
    random: 'view-random',
    examsMenu: 'view-exams-menu',
    modeSelection: 'view-mode-selection',
    progress: 'view-progress',
    search: 'view-search',
    game: 'view-game',
    results: 'view-results'
};

/**
 * Show a named view and hide all others.
 * @param {string} viewName - key from VIEW_IDS
 * @param {boolean} addToHistory - whether to record this in navigation history
 */
export function showView(viewName, addToHistory = true) {
    const targetId = VIEW_IDS[viewName] || viewName;
    const target = document.getElementById(targetId);
    if (!target) {
        console.warn(`showView: no element found for "${viewName}" (id: "${targetId}")`);
        return;
    }

    // ── GESTIÓN DE HISTORIAL ──
    if (viewName === 'roleSelection') {
        state.viewHistory = []; // Reset total al volver a la raíz
        history.replaceState({ view: 'roleSelection' }, '');
    } else if (addToHistory) {
        const currentActive = Object.values(VIEW_IDS).find(id => {
            const el = document.getElementById(id);
            return el && el.classList.contains('active');
        });
        // Solo guardamos si es una vista distinta para evitar bucles
        if (currentActive && currentActive !== targetId) {
            state.viewHistory.push(currentActive);
            // Sincronizar con el historial del navegador
            history.pushState({ view: viewName }, '');
        }
    }

    // Gestionar visibilidad del botón "Volver" en el menú raíz
    if (viewName === 'menu') {
        // Si venimos de un lugar que reinicia historial, u ocultamos si no hay vuelta atrás útil
        const btnBack = document.getElementById('btn-back-menu');
        if (btnBack) {
            // Si el historial está vacío (salto directo o reset), ocultamos el botón de volver
            btnBack.style.visibility = (state.viewHistory.length === 0) ? 'hidden' : 'visible';
        }
    }

    // Hide all views
    Object.values(VIEW_IDS).forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('active');
            el.classList.add('hidden');
        }
    });

    // Show the target view
    target.classList.remove('hidden');
    target.classList.add('active');

    // ACTUALIZACIÓN: Renderizar progreso global si estamos en vistas que lo muestran
    if (viewName === 'menu' || viewName === 'parts') {
        renderizarProgresoGlobal();
    }
    if (viewName === 'examsMenu') {
        renderizarProgresoExamenes();
    }
    if (viewName === 'topics') {
        // Al volver a temas, refrescar todos los progress bars que haya en el contenedor
        document.querySelectorAll('#topics-container .btn-topic').forEach(btn => {
            const testId = btn.getAttribute('data-testid');
            if (testId) {
                // El filtro es complejo de recuperar, así que usamos la lógica de slugify
                // Para temas base, q.tema.startsWith(baseTema). 
                // Para chunks, q.tema === chunkQ.
                // En topics.js ya inyectamos el progreso. Aquí solo queremos que se ACTUALICE.
                // Para simplificar, si el botón tiene data-testid, renderizarProgresoEnCard lo puede manejar
                // si le pasamos un filtro genérico basado en el testId.
                // Pero es mejor que la propia función renderizarProgresoEnCard lo detecte.
                renderizarProgresoEnCard(btn, null); 
            }
        });
    }

    window.scrollTo(0, 0);
}

/**
 * Navega a la vista anterior en el historial.
 */
export function goBack() {
    if (state.viewHistory.length > 0) {
        const prevViewId = state.viewHistory.pop();
        // search the key for the ID
        const viewKey = Object.keys(VIEW_IDS).find(key => VIEW_IDS[key] === prevViewId) || prevViewId;
        showView(viewKey, false);
        // También quitamos la entrada del historial del navegador (popstate se encargará si es el botón del navegador)
        history.back();
    } else {
        // Fallback: Si no hay historial, volver a la selección de rol
        showView('roleSelection', false);
    }
}

/**
 * Show or hide any element by ID using the .hidden class.
 * @param {string} id
 * @param {boolean} visible
 */
export function toggleEl(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;
    if (visible) el.classList.remove('hidden');
    else el.classList.add('hidden');
}

/**
 * Update the failure badge counter in the menu.
 * @param {number} count
 */
export function updateFailureBadge(count) {
    const badge = document.getElementById('badge-failures');
    const btnFail = document.getElementById('btn-failures');

    if (count > 0) {
        if (badge) { badge.innerText = count; badge.classList.remove('hidden'); }
        if (btnFail) { btnFail.disabled = false; btnFail.style.opacity = '1'; }
    } else {
        if (badge) badge.classList.add('hidden');
        if (btnFail) { btnFail.disabled = true; btnFail.style.opacity = '0.5'; }
    }
}

/**
 * Recorre los récords e inyecta badges de forma discreta.
 */
export function renderizarRecordsMenu() {
    const records = Storage.getRecords();
    
    // Limpiar todos los badges y estilos previos primero
    document.querySelectorAll('.badge-record').forEach(b => b.remove());
    document.querySelectorAll('.card-has-record').forEach(c => c.classList.remove('card-has-record'));

    // Iterar sobre los récords guardados
    Object.keys(records).forEach(testId => {
        const score = records[testId];
        
        // Estrategia 1: Buscar por ID directo o ID generado
        let btn = document.getElementById(`btn-topic-${testId}`) || document.getElementById(testId);
        
        // Estrategia 2: Buscar por atributo data-testid
        if (!btn) {
            btn = document.querySelector(`[data-testid="${testId}"]`);
        }

        if (btn) {
            btn.classList.add('card-has-record');
            
            // Inyectar badge discreto (Sello Premium)
            const badge = document.createElement('span');
            badge.className = 'badge-record';
            badge.innerHTML = getRecordBadgeHTML(score);
            btn.appendChild(badge);
        }
    });
}

/**
 * Genera el HTML para el badge de récord con estética Premium.
 * @param {number} score - Nota de 0 a 10.
 */
function getRecordBadgeHTML(score) {
    const isPass = score >= 5;
    const statusIcon = isPass ? '✅' : '❌';
    const statusText = isPass ? 'Completado' : 'Suspenso';
    
    let scoreIcon = '⚠️';
    if (score >= 10) scoreIcon = '👑';
    else if (score >= 9) scoreIcon = '💎';
    else if (score >= 7) scoreIcon = '🏆';
    else if (score >= 5) scoreIcon = '🎖️';

    return `
        ${statusIcon} <span style="margin-left:2px;">${statusText}</span>
        <span style="margin:0 6px; opacity:0.4;">|</span>
        ${scoreIcon} <span style="font-weight:bold;">${score.toFixed(1)}</span>
    `.trim();
}

export function slugify(text) {
    if (!text) return '';
    return text.toString().toLowerCase().trim()
        .replace(/\s+/g, '_')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '_')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

/**
 * Calcula y renderiza barras de progreso en tarjetas que agrupan temas.
 */
export function renderizarProgresoGlobal() {
    const records = Storage.getRecords();
    const allQuestions = state.allQuestions;

    // 1. Identificar contenedores de categorías/bloques (Nivel 1 y 2)
    const categories = [
        { id: 'btn-source-mad', filter: q => q.origen === 'MAD', aggregate: true },
        { id: 'btn-source-csif', filter: q => q.origen === 'CSIF', aggregate: true },
        { id: 'btn-source-academia', filter: q => q.origen === 'Academia', aggregate: true },
        { id: 'btn-source-examenes', filter: q => q.source === 'Histo' || q.origen === 'Historico', aggregate: true },
        { id: 'btn-part-general', filter: q => {
            const m = q.tema && q.tema.match(/tema\s+(\d+)/i);
            return m && parseInt(m[1]) >= 1 && parseInt(m[1]) <= 6;
        }, aggregate: true },
        { id: 'btn-part-especifica', filter: q => {
            const m = q.tema && q.tema.match(/tema\s+(\d+)/i);
            return m && parseInt(m[1]) >= 7 && parseInt(m[1]) <= 16;
        }, aggregate: true }
    ];

    categories.forEach(cat => {
        const btn = document.getElementById(cat.id);
        if (btn) {
            btn.setAttribute('data-aggregate', 'true'); // Niveles 1 y 2 son siempre agregados
            renderizarProgresoEnCard(btn, cat.filter);
        }
    });
}

/**
 * Inyecta una barra de progreso y nota media en un elemento basado en un filtro de preguntas.
 * REGLA DE ORO: Aislamiento total entre fuentes y partes mediante matching estricto.
 */
export function renderizarProgresoEnCard(element, questionsFilter) {
    if (!element) return;
    const records = Storage.getRecords();
    const allQuestions = state.allQuestions;

    // Limpiar previo
    const oldWrap = element.querySelector('.global-progress-wrapper');
    if (oldWrap) oldWrap.remove();

    const isTopicBtn = element.id && element.id.startsWith('btn-topic-');
    let testId = element.getAttribute('data-testid') || (isTopicBtn ? element.id.replace('btn-topic-', '') : '');
    
    // Ignorar testId si no tiene formato de slug (pasa en botones de nivel 1 como btn-source-mad)
    if (testId && testId.startsWith('btn-')) testId = '';

    const isAggregate = element.getAttribute('data-aggregate') === 'true';

    // ── REGLA 1: TEST ATÓMICO (Sin herencia, sin prefijos laxos) ──
    if (!isAggregate && testId) {
        // En botones de nivel 3 (Partes/Bloques), buscamos EXACTAMENTE la clave.
        const score = records[testId];
        if (score !== undefined) {
            injectProgressHTML(element, 100, score.toFixed(1));
        }
        return;
    }

    // ── REGLA 2: AGREGACIÓN (Padres, Fuentes) ──
    const prefixMap = {
        'btn-source-mad': 'mad_',
        'btn-source-csif': 'csif_',
        'btn-source-academia': 'academia_',
        'btn-source-examenes': 'ope_',
        'btn-part-general': 'general_', // Prefijo virtual, usaremos lógica de temas
        'btn-part-especifica': 'especifica_' // Prefijo virtual
    };

    const sourcePrefix = prefixMap[element.id];
    
    // Si no es un botón de nivel 1/2 y no tiene testId, abortamos
    if (!sourcePrefix && !testId && !questionsFilter) return;

    // Obtener todos los récords para calcular la media
    const allRecords = Storage.getRecords();
    let scores = [];

    if (sourcePrefix && sourcePrefix.endsWith('_')) {
        // Filtrado por prefijo de storage (MAD, CSIF, etc.)
        scores = Object.keys(allRecords)
            .filter(k => k.startsWith(sourcePrefix))
            .map(k => allRecords[k]);
    } else if (element.id === 'btn-part-general' || element.id === 'btn-part-especifica') {
        const isGeneral = element.id === 'btn-part-general';
        // Para bloques General/Específica, filtramos temas 1-6 o 7-16
        scores = Object.keys(allRecords).filter(k => {
            const m = k.match(/tema_(\d+)/i);
            if (!m) return false;
            const n = parseInt(m[1]);
            return isGeneral ? (n >= 1 && n <= 6) : (n >= 7 && n <= 16);
        }).map(k => allRecords[k]);
    } else if (questionsFilter) {
        // Fallback para filtros manuales si los hay
        const targetQs = allQuestions.filter(questionsFilter);
        if (targetQs.length === 0) return;
        // En este caso, si no hay prefijo claro, el cálculo es más complejo.
        // Pero para Nivel 1 y 2, los casos anteriores cubren el 99%.
    }

    if (scores.length > 0) {
        const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
        // Para el % de progreso, podemos estimar basado en los completados vs total esperado
        // O simplemente mostrar la nota media si es un nivel muy alto.
        // El usuario pidió "pinta las barras de nuevo", así que calculamos un % de "completitud" 
        // respecto a un total aproximado si es posible, o simplemente 100% si hay datos.
        injectProgressHTML(element, 100, avg); 
    }
}

/**
 * Determina cuántos tests atómicos (botones finales) genera un set de preguntas dado.
 * Reclculo dinámico del denominador para evitar inconsistencias.
 */
function countTotalAtomicTests(questions) {
    if (questions.length === 0) return 0;

    const groups = {};
    questions.forEach(q => {
        const source = q.origen || q.source || 'UNK';
        const rawTema = q.tema || 'UNK';
        
        // Agrupar por Test Unitario
        if (rawTema.toLowerCase().includes('bloque') || rawTema.toLowerCase().includes('test')) {
            const key = `${source}_${rawTema}`;
            groups[key] = (groups[key] || 0) + 1;
        } else {
            const m = rawTema.match(/(Tema \d+)/i);
            const base = m ? m[1] : rawTema;
            const key = `${source}_${base}`;
            groups[key] = (groups[key] || 0) + 1;
        }
    });

    let total = 0;
    Object.keys(groups).forEach(key => {
        const count = groups[key];
        if (key.toLowerCase().includes('bloque') || key.toLowerCase().includes('test')) {
            // Un bloque individual no suele tener subpartes si es < 20, pero el código actual 
            // permite trocear bloques también. Si > 20, genera Full + Partes.
            if (count > 20) {
                const numParts = Math.ceil(count / 20);
                total += (1 + numParts);
            } else {
                total += 1;
            }
        } else {
            // Tema base: Botón Completo + N Partes
            const numParts = Math.ceil(count / 20);
            total += (1 + numParts); 
        }
    });

    return total;
}

/**
 * Helper para aislar fuentes en Nivel 1
 */
function inferSourcePrefixFromQuestions(qs) {
    if (qs.length === 0) return null;
    const first = qs[0];
    const source = first.origen || first.source;
    if (source === 'MAD') return 'mad';
    if (source === 'CSIF') return 'csif';
    if (source === 'Academia') return 'academia';
    if (source === 'Historico' || first.source === 'Histo') return 'ope';
    return null;
}

function injectProgressHTML(element, pct, avg) {
    const wrapper = document.createElement('div');
    wrapper.className = 'global-progress-wrapper';
    wrapper.innerHTML = `
        <div class="global-progress-info">
            <span>Progreso: ${pct}%</span>
            <span>Media: ${avg}</span>
        </div>
        <div class="global-progress-bar-bg">
            <div class="global-progress-bar-fill" style="width: ${pct}%"></div>
        </div>
    `;
    element.appendChild(wrapper);
}

/**
 * Renderiza progreso específico para la sección de exámenes.
 */
export function renderizarProgresoExamenes() {
    const exams = [
        { id: 'btn-topic-ope_2024_cel', filter: q => q.tema === 'Examen Oficial Celador/a SESCAM 2024' },
        { id: 'btn-topic-ope_2020_ord', filter: q => q.tema === 'Examen 2020 (Ordinario)' },
        { id: 'btn-topic-ope_2020_extra', filter: q => q.tema === 'Examen 2020 (Extraordinario)' },
        { id: 'btn-examenes-ccaa', filter: q => q.tema && q.tema.includes('Otras Comunidades') },
        { id: 'btn-examenes-historico', filter: q => q.tema && !q.tema.includes('Otras Comunidades') && !q.tema.includes('Examen 2020') && !q.tema.includes('SESCAM 2024') }
    ];

    exams.forEach(ex => {
        const btn = document.getElementById(ex.id);
        if (btn) renderizarProgresoEnCard(btn, ex.filter);
    });
}
