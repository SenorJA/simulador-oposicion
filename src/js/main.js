/**
 * main.js — Application entry point.
 * Orchestrates: auth → data load → UI init → ALL event listeners.
 */
import * as Auth from './modules/auth.js';
import * as Data from './modules/data.js';
import * as UI from './modules/ui.js';
import * as Storage from './modules/storage.js';
import * as Topics from './modules/topics.js';
import * as Game from './modules/game.js';
import { state } from './modules/state.js';
import { CONFIG } from './modules/config.js';

document.addEventListener('DOMContentLoaded', () => {
    // ── Diálogos accesibles: Escape cierra, Tab queda atrapado dentro ──────
    setupDialogA11y();

    // ── Auth flow ──────────────────────────────────────────────────────────
    setupAccessRetry();

    Auth.checkAuth({
        onDenied: (msg) => {
            const titleEl = document.getElementById('access-title');
            const msgEl = document.getElementById('access-msg');
            const overlay = document.getElementById('access-overlay');
            if (overlay) overlay.classList.remove('hidden'); // Ensure it's visible on denial
            if (titleEl) { titleEl.innerText = 'Acceso Denegado'; titleEl.style.color = 'red'; }
            if (msgEl) msgEl.innerText = msg;
            const retryBox = document.getElementById('access-retry');
            if (retryBox) retryBox.classList.remove('hidden');
        },
        onSuccess: (_userData, _currentDevices, _maxDevices) => {
            const overlay = document.getElementById('access-overlay');
            if (overlay) overlay.classList.add('hidden');

            // ── Role Control ──
            const isAdmin = (_userData.id_acceso === 'PichonJefe');
            UI.toggleEl('btn-admin-panel', isAdmin);
            console.log(`[AUTH] User: ${_userData.id_acceso} | Admin: ${isAdmin}`);

            const licEl = document.getElementById('licencia-activa');
            if (licEl) licEl.style.display = 'inline-block';

            Data.loadAllData().then(questions => {
                if (questions.length === 0) {
                    // Antes esto salía en silencio y el usuario se quedaba con la
                    // pantalla en blanco. Ahora se explica qué ha pasado.
                    showFatalDataError(Data.getLastLoadReport());
                    return;
                }

                // One-time data migration for old IDs
                // v2: los Temas 11-16 de MAD tenían IDs duplicados entre temas;
                // se renumeraron (mad_t{N}_xxx) y los fallos antiguos quedan huérfanos
                if (Storage.getVersionData() !== 'v2_unique_ids') {
                    Storage.clearFailures();
                    Storage.setVersionData('v2_unique_ids');
                }

                UI.updateFailureBadge(Storage.getFailedIds().length);
                UI.renderizarRecordsMenu();
                UI.renderizarProgresoGlobal();
                UI.renderizarProgresoExamenes();
                setupEventListeners();
                UI.showView('roleSelection', false); // Usar el sistema de navegación real
            });
        }
    });

    // ── Browsing History Fix ──
    window.onpopstate = (event) => {
        if (event.state && event.state.view) {
            UI.showView(event.state.view, false);
        }
    };
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Accesibilidad de los modales: al abrirse mueve el foco dentro de ellos y lo
 * mantiene atrapado (Tab/Shift+Tab); al cerrarse lo devuelve a donde estaba.
 * Escape cierra el diálogo visible usando su propio botón de cierre.
 */
function setupDialogA11y() {
    const DIALOGS = ['admin-modal', 'nav-grid-overlay'];
    const FOCALIZABLES = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focoPrevio = new WeakMap();

    const dialogoVisible = () => DIALOGS
        .map(id => document.getElementById(id))
        .find(el => el && !el.classList.contains('hidden'));

    for (const id of DIALOGS) {
        const el = document.getElementById(id);
        if (!el) continue;
        new MutationObserver(() => {
            const abierto = !el.classList.contains('hidden');
            if (abierto && !focoPrevio.has(el)) {
                focoPrevio.set(el, document.activeElement);
                const foco = el.querySelector(FOCALIZABLES);
                if (foco) foco.focus();
            } else if (!abierto && focoPrevio.has(el)) {
                const prev = focoPrevio.get(el);
                focoPrevio.delete(el);
                if (prev && typeof prev.focus === 'function') prev.focus();
            }
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('keydown', e => {
        const dlg = dialogoVisible();
        if (!dlg) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            const cerrar = dlg.querySelector('#btn-close-admin, #btn-close-grid');
            if (cerrar) cerrar.click();
            return;
        }

        if (e.key === 'Tab') {
            const focos = [...dlg.querySelectorAll(FOCALIZABLES)].filter(el => !el.disabled);
            if (!focos.length) return;
            const primero = focos[0];
            const ultimo = focos[focos.length - 1];
            if (e.shiftKey && document.activeElement === primero) {
                e.preventDefault();
                ultimo.focus();
            } else if (!e.shiftKey && document.activeElement === ultimo) {
                e.preventDefault();
                primero.focus();
            }
        }
    });
}

/**
 * Error irrecuperable de carga: no hay ninguna pregunta con la que arrancar.
 * Se muestra en el overlay de acceso (que sigue visible) con instrucciones
 * accionables, en vez de dejar la pantalla en blanco.
 */
function showFatalDataError(report) {
    const overlay = document.getElementById('access-overlay');
    const titleEl = document.getElementById('access-title');
    const msgEl = document.getElementById('access-msg');

    const fallidos = report?.bankErrors || [];
    const detalle = fallidos.length
        ? fallidos.map(b => `<div style="font-size:.75rem;opacity:.85;margin-top:.4rem">${b}</div>`).join('')
        : '<div style="font-size:.75rem;opacity:.85;margin-top:.4rem">Revisa la consola (F12) para más detalle.</div>';

    if (overlay) overlay.classList.remove('hidden');
    if (titleEl) { titleEl.innerText = 'Error de carga'; titleEl.style.color = '#b91c1c'; }
    if (msgEl) {
        msgEl.innerHTML = `No se han podido cargar las preguntas (${report?.banks ?? 0} de 17 bancos disponibles).
            <div style="font-size:.8rem;margin-top:.6rem;font-weight:normal">
                Comprueba tu conexión y recarga la página. Si persiste, avisa con el detalle de abajo.
            </div>${detalle}`;
    }
    console.error('[MAIN] Carga de datos fallida', report);
}

/**
 * Reintento tras un "Acceso Denegado".
 * El código se pasa por ?user= en la URL (mismo canal que usa Auth.checkAuth).
 * Se recarga la página para que todo el arranque vuelva a pasar por checkAuth
 * una única vez, sin duplicar listeners ni el estado global de `state`.
 * NO toca la lógica de autenticación: solo navegación.
 */
function setupAccessRetry() {
    const retryBox = document.getElementById('access-retry');
    const input = document.getElementById('access-code-input');
    const btn = document.getElementById('btn-access-retry');
    if (!retryBox || !input || !btn) return;

    const retry = () => {
        const code = input.value.trim();
        if (!code) { input.focus(); return; }
        const url = new URL(window.location.href);
        url.searchParams.set('user', code);
        window.location.href = url.toString();
    };

    btn.addEventListener('click', retry);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); retry(); }
    });
}

/**
 * Selección de categoría (pinche | celador).
 * La Parte General (Temas 1-6) es común a ambas categorías: se comparten
 * las mismas preguntas, pero el progreso se almacena aislado por rol.
 */
function selectRole(role) {
    state.currentRole = role;
    Storage.setRole(role);

    // Vaciar memoria local de fallos y estado al cambiar
    state.userAnswers = {};
    state.currentQuestions = [];

    const menuTitle = document.querySelector('#view-menu h1');
    if (menuTitle) menuTitle.innerText = role === 'celador' ? 'Simulador OPE Celador' : 'Simulador OPE Pinche';

    // Forzar actualización reactiva (cada rol tiene sus propios datos aislados)
    UI.updateFailureBadge(Storage.getFailedIds().length);
    UI.renderizarRecordsMenu();
    UI.renderizarProgresoGlobal();
    UI.renderizarProgresoExamenes();
    checkAndInjectSessionButton(); // El test en pausa es distinto por rol
    UI.showView('menu');
}

// ── Event Listeners ────────────────────────────────────────────────────────

/**
 * Registra un listener solo si el elemento existe. Evita que un id
 * renombrado en index.html rompa en cascada el resto de listeners
 * (un getElementById(...).addEventListener directo lanzaría TypeError).
 */
function on(id, event, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
    else console.warn(`[MAIN] Elemento no encontrado: #${id}`);
}

function setupEventListeners() {
    checkAndInjectSessionButton();

    // ── Role selection ──
    const btnPinche = document.getElementById('btn-role-pinche');
    if (btnPinche) btnPinche.addEventListener('click', () => selectRole('pinche'));

    const btnCelador = document.getElementById('btn-role-celador');
    if (btnCelador) btnCelador.addEventListener('click', () => selectRole('celador'));

    // ── Admin ──
    on('btn-admin-panel', 'click', loadAdminLogs);
    on('btn-close-admin', 'click', () => UI.toggleEl('admin-modal', false));

    // ── Main menu ──
    on('btn-back-menu', 'click', () => UI.goBack());
    on('btn-source-mad', 'click', () => Topics.showParts('MAD'));
    on('btn-source-csif', 'click', () => Topics.showParts('CSIF'));
    on('btn-source-academia', 'click', () => Topics.showParts('Academia'));
    on('btn-source-examenes', 'click', () => {
            UI.renderizarProgresoExamenes();
            
            // Reset Limpio para Pinche, ocultar para Celador
            const isCelador = state.currentRole === 'celador';
            const display = isCelador ? 'none' : '';
            
            const btnIds = [
                'btn-topic-ope_2026_pinche_ord',
                'btn-topic-ope_2026_pinche_extra',
                'btn-topic-ope_2026_cocinero',
                'btn-topic-ope_2026_tecnico_ti',
                'btn-topic-ope_2020_ord',
                'btn-topic-ope_2020_extra'
            ];
            
            btnIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = display;
            });
            
            UI.showView('examsMenu');
        });

    // ── Failures ──
    on('btn-failures', 'click', () => {
        const ids = Storage.getFailedIds();
        const qs = state.allQuestions.filter(q => ids.includes(q.id));
        if (qs.length === 0) { alert('¡No tienes fallos registrados!'); return; }
        Game.startGame(qs, 'failures', 'Repaso de Fallos');
    });

    // ── Random ──
    on('btn-random', 'click', () => { initRandomView(); UI.showView('random'); });

    // ── Progress ──
    on('btn-progress', 'click', showProgress);

    // ── Parts ──
    on('btn-back-parts', 'click', () => UI.goBack());
    on('btn-part-general', 'click', () => Topics.showTopics('GENERAL'));
    on('btn-part-especifica', 'click', () => Topics.showTopics('ESPECIFICA'));

    // ── Topics ──
    on('btn-back-topics', 'click', () => {
        UI.goBack();
    });

    // ── Exams ──
    on('btn-back-exams', 'click', () => UI.goBack());
    on('btn-topic-ope_2026_pinche_ord', 'click', () => {
        const qs = state.allQuestions.filter(q => q.origen === 'OPE SESCAM Pinche Ordinario 2026');
        if (!qs.length) return alert('Examen no cargado.');
        Topics.prepareModeSelection('Examen OPE 2026 (Pinche Ordinario)', () => qs, 'ope_2026_pinche_ord');
    });

    on('btn-topic-ope_2026_pinche_extra', 'click', () => {
        const qs = state.allQuestions.filter(q => q.origen === 'OPE SESCAM Pinche Extraordinario 2026');
        if (!qs.length) return alert('Examen no cargado.');
        Topics.prepareModeSelection('Examen OPE 2026 (Pinche Extraordinario)', () => qs, 'ope_2026_pinche_extra');
    });

    on('btn-topic-ope_2026_cocinero', 'click', () => {
        const qs = state.allQuestions.filter(q => q.origen === 'OPE SESCAM Cocinero 2026');
        if (!qs.length) return alert('Examen no cargado.');
        Topics.prepareModeSelection('Examen OPE 2026 (Cocinero/a)', () => qs, 'ope_2026_cocinero');
    });

    on('btn-topic-ope_2026_tecnico_ti', 'click', () => {
        const qs = state.allQuestions.filter(q => q.tema === 'Examen Oficial Técnico de Gestión de TI SESCAM 2026');
        if (!qs.length) return alert('Examen no cargado.');
        Topics.prepareModeSelection('Examen OPE 2026 (Técnico Gestão TI)', () => qs, 'ope_2026_tecnico_ti');
    });

    on('btn-topic-ope_2026_celador', 'click', () => {
        const qs = state.allQuestions.filter(q => q.origen === 'OPE SESCAM Celador 2026');
        if (!qs.length) return alert('Examen no cargado.');
        Topics.prepareModeSelection('Examen OPE 2026 (Celador/a)', () => qs, 'ope_2026_celador');
    });

    on('btn-topic-ope_2026_celador_extra', 'click', () => {
        const qs = state.allQuestions.filter(q => q.tema === 'Examen Oficial Celador/a Extraordinario SESCAM 2026');
        if (!qs.length) return alert('Examen no cargado.');
        Topics.prepareModeSelection('Examen OPE 2026 (Celador/a Extraordinario)', () => qs, 'ope_2026_celador_extra');
    });

    on('btn-topic-ope_2024_cel', 'click', () => {
        const qs = state.allQuestions.filter(q => q.tema === 'Examen Oficial Celador/a SESCAM 2024');
        if (!qs.length) return alert('Examen no cargado.');
        Topics.prepareModeSelection('Examen Celador SESCAM 2024', () => qs, 'ope_2024_cel');
    });

    on('btn-topic-ope_2020_ord', 'click', () => {
        const qs = state.allQuestions
            .filter(q => q.tema === 'Examen 2020 (Ordinario)')
            .sort((a, b) => (parseInt(a.id?.split('_')[1]) || 0) - (parseInt(b.id?.split('_')[1]) || 0));
        if (!qs.length) return alert('Examen no cargado.');
        Topics.prepareModeSelection('Examen OPE 2020 (Ordinario)', () => qs, 'ope_2020_ord');
    });

    on('btn-topic-ope_2020_extra', 'click', () => {
        const qs = state.allQuestions
            .filter(q => q.tema === 'Examen 2020 (Extraordinario)')
            .sort((a, b) => (parseInt(a.id?.split('_')[1]) || 0) - (parseInt(b.id?.split('_')[1]) || 0));
        if (!qs.length) return alert('🚧 Examen aún no disponible.');
        Topics.prepareModeSelection('Examen OPE 2020 (Extraordinario)', () => qs, 'ope_2020_extra');
    });
    on('btn-examenes-ccaa', 'click', () => {
        state.currentSource = 'Historico';
        Topics.showTopics('CCAA');
    });
    on('btn-examenes-historico', 'click', () => {
        state.currentSource = 'Historico';
        Topics.showTopics('HISTORICO');
    });

    // ── Mode selection ──
    on('btn-back-mode', 'click', () => UI.goBack());
    on('btn-mode-training', 'click', () => triggerGameStart('training'));
    on('btn-mode-exam', 'click', () => triggerGameStart('exam'));

    // ── Timer Toggle ──
    on('toggle-timer', 'change', (e) => {
        state.timerEnabled = e.target.checked;
    });

    // ── Random config ──
    on('btn-back-random', 'click', () => UI.goBack());
    on('btn-start-random', 'click', startRandom);

    // Click en Segmentos (Delegación)
    document.querySelectorAll('.segmented-control').forEach(container => {
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.segment');
            if (!btn) return;
            
            // Activar visualmente
            container.querySelectorAll('.segment').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');

            // Lógica específica para Cronómetro
            if (container.id === 'list-timer-mode') {
                UI.toggleEl('timer-minutes-selector', btn.dataset.value === 'on');
            }
        });
    });

    // Click en Tarjetas de Fuente
    document.querySelectorAll('.source-card').forEach(card => {
        card.addEventListener('click', () => {
            card.classList.toggle('active');
        });
    });

    // ── Progress ──
    on('btn-back-progress', 'click', () => UI.goBack());
    on('btn-clear-history', 'click', () => {
        if (confirm('¿Borrar todo el historial?')) { Storage.clearHistory(); showProgress(); }
    });
    on('btn-clear-records', 'click', () => {
        if (confirm('¿Estás seguro de que quieres borrar todos tus récords y medallas? Esta acción no se puede deshacer.')) {
            Storage.clearRecords();
            UI.renderizarRecordsMenu();
            alert('¡Progreso limpiado correctamente!');
        }
    });

    // ── Game controls ──
    on('btn-quit-game', 'click', () => {
        if (confirm('¿Salir al menú? Tu test actual quedará guardado automáticamente.')) {
            Game.stopTimer(); // Detener cronómetro (sin borrar el tiempo guardado)
            checkAndInjectSessionButton(); // Refresca UI
            UI.goBack(); 
        }
    });
    on('btn-next', 'click', () => Game.nextQuestion());
    on('btn-prev', 'click', () => Game.prevQuestion());
    on('btn-show-grid', 'click', () => Game.showGrid());
    on('btn-toggle-fullview', 'click', () => Game.toggleFullView());
    on('btn-close-grid', 'click', () => UI.toggleEl('nav-grid-overlay', false));

    // ── Results ──
    on('btn-home-results', 'click', () => {
        checkAndInjectSessionButton();
        UI.renderizarRecordsMenu();
        UI.renderizarProgresoGlobal();
        UI.renderizarProgresoExamenes();
        
        // BUG FIX: Reset navigation when going home from results
        state.viewHistory = []; 
        UI.showView('menu', false);
        // Replace state to avoid going back to results
        history.replaceState({ view: 'menu' }, '');
    });
    on('btn-back-selection', 'click', () => {
        UI.renderizarRecordsMenu();
        UI.renderizarProgresoGlobal();
        UI.renderizarProgresoExamenes();
        UI.showView(state.lastViewBeforeMode || 'topics');
    });
    on('btn-retry', 'click', () => {
        if (state.pendingGameGenerator) triggerGameStart(state.originalMode || 'training');
    });
    // btn-review-exam / btn-review-failed are bound dynamically in game.js finishGame()

    // ── Failure clear buttons ──
    on('btn-clear-failures-header', 'click', () => clearFailuresAndRefresh(true));
    on('btn-clear-failures', 'click', () => clearFailuresAndRefresh(false));
}

/**
 * Vacía el historial de fallos del rol actual y refresca la UI afectada.
 * Si el test en pausa era un repaso de fallos, también se descarta.
 * @param {boolean} goToMenu Volver al menú tras limpiar (botón del header).
 */
function clearFailuresAndRefresh(goToMenu) {
    const msg = goToMenu ? '¿Vaciar historial de fallos?' : '¿Borrar todos los fallos guardados?';
    if (!confirm(msg)) return;

    Storage.clearFailures();

    const session = Storage.getSuspendedSession();
    if (session && session.currentMode === 'failures') {
        Storage.clearSuspendedSession();
    }

    UI.updateFailureBadge(0);
    if (!goToMenu) {
        UI.toggleEl('btn-review-failed', false);
        UI.toggleEl('btn-clear-failures', false);
    }
    checkAndInjectSessionButton();
    if (goToMenu) UI.showView('menu');
}

// ── Feature helpers ────────────────────────────────────────────────────────

function triggerGameStart(mode) {
    if (!state.pendingGameGenerator) { alert('No hay tema seleccionado.'); return; }
    const qs = state.pendingGameGenerator();
    if (!qs || qs.length === 0) { alert('No hay preguntas para este test.'); return; }
    state.currentMode = mode;
    state.originalMode = mode;
    Game.startGame(qs, mode, state.pendingTopicTitle || 'Test', state.pendingTestId);
}

function initRandomView() {
    // 1. Resetear todos los segmentos primero
    document.querySelectorAll('.segmented-control .segment').forEach(s => s.classList.remove('active'));
    
    // 2. Activar por defecto [20 preguntas], [Sin Tiempo], [Mixto]
    const defaults = document.querySelectorAll('.segment[data-value="20"], .segment[data-value="off"], .segment[data-value="mix"]');
    defaults.forEach(s => s.classList.add('active'));

    // 3. Activar todas las fuentes por defecto
    document.querySelectorAll('.source-card').forEach(c => c.classList.add('active'));

    // 4. Ocultar selector de minutos (ya que el default es 'off')
    UI.toggleEl('timer-minutes-selector', false);
}

function startRandom() {
    // 1. Obtener cantidad
    const countBtn = document.querySelector('#list-random-count .segment.active');
    const count = parseInt(countBtn ? countBtn.dataset.value : 20);

    // 2. Obtener Timer
    const timerModeBtn = document.querySelector('#list-timer-mode .segment.active');
    const timerOn = timerModeBtn && timerModeBtn.dataset.value === 'on';
    const timerMins = parseInt(document.getElementById('select-random-time').value) || 15;

    // 3. Obtener Fuentes activas
    const activeSources = Array.from(document.querySelectorAll('.source-card.active'))
                               .map(c => c.dataset.source);

    // 4. Obtener Filtro Temario
    const scopeBtn = document.querySelector('#list-random-scope .segment.active');
    const scope = scopeBtn ? scopeBtn.dataset.value : 'mix'; // general, especifica, mix

    let pool = state.allQuestions;

    if (state.currentRole === 'celador') {
        pool = pool.filter(q => {
            const isMAD = q.origen === 'MAD' || q.source === 'MAD';
            const isCSIF = q.origen === 'CSIF' || q.source === 'CSIF';
            const isAcademia = q.origen === 'Academia' || q.source === 'Academia';
            const isHisto = q.source === 'Histo' || q.source === 'Historico' || String(q.origen).includes('Examen') || String(q.origen).includes('OPE');
            
            if (isMAD || isCSIF) {
                return Topics.isGeneralTopic(q);
            }
            if (isAcademia) return true;
            if (isHisto) {
                return (q.origen || '').toLowerCase().includes('celador') || (q.tema || '').toLowerCase().includes('celador');
            }
            return false;
        });
    }

    // Filtrar por fuentes
    if (activeSources.length > 0) {
        pool = pool.filter(q => {
            if (activeSources.includes(q.origen)) return true;
            // Legacy / Histo fix
            if (activeSources.includes('Historico') && (q.source === 'Histo' || q.source === 'Historico')) return true;
            return false;
        });
    }

    // Filtrar por temario
    if (scope !== 'mix') {
        pool = pool.filter(q => {
            if (scope === 'general') return Topics.isGeneralTopic(q);
            if (scope === 'especifica') return Topics.isSpecificTopic(q);
            return true; // No pudimos clasificarla, la mantenemos
        });
    }

    if (pool.length === 0) {
        return alert('No hay preguntas con los filtros seleccionados.');
    }

    // Mezclar y recortar
    const selected = [...pool].sort(() => 0.5 - Math.random()).slice(0, Math.min(count, pool.length));
    
    // Iniciar directamente 🚀
    const mode = timerOn ? 'exam' : 'training';
    state.timerEnabled = true; // Siempre habilitamos el cronómetro (si timerOn=false actuará como count-up)
    
    if (timerOn) {
        Game.startGame(selected, mode, `Test Aleatorio (${selected.length} pregs)`, null, timerMins * 60);
    } else {
        // En training mode / sin tiempo, simplemente empezamos sin pasar customSeconds
        // para que Game.startGame sepa que no hay limite de cuenta atrás.
        state.timerEnabled = false; 
        Game.startGame(selected, mode, `Test Aleatorio (${selected.length} pregs)`);
    }
}


function showProgress() {
    const tbody = document.getElementById('progress-body');
    const history = Storage.getHistory();
    tbody.innerHTML = history.length === 0
        ? '<tr><td colspan="3" style="text-align:center">No hay resultados aún.</td></tr>'
        : history.map(r => `<tr>
            <td>${r.date}</td>
            <td>${r.topic}</td>
            <td class="${r.pct >= 50 ? 'score-good' : 'score-bad'}">${r.score}/${r.total} (${r.pct}%)</td>
          </tr>`).join('');
    UI.showView('progress');
}

// ── Admin panel ────────────────────────────────────────────────────────────

async function loadAdminLogs() {
    // ── Security Check (solo frontend: la autorización real debe hacerse con RLS) ──
    const userId = String(Storage.getSavedUser() || '');
    if (userId.trim().toLowerCase() !== CONFIG.ADMIN_USER.toLowerCase()) {
        alert('Acceso no autorizado.');
        return;
    }

    if (!state.supabaseClient) return;
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="2" style="text-align:center">Cargando...</td></tr>';
    UI.toggleEl('admin-modal', true);
    try {
        const [{ data: lics }, { data: logs }] = await Promise.all([
            state.supabaseClient.from(CONFIG.TABLE_USERS).select('*').order('dispositivos_usados', { ascending: false }),
            state.supabaseClient.from(CONFIG.TABLE_LOGS).select('*').order('created_at', { ascending: false }).limit(30)
        ]);
        let html = `<tr style="background:#f4f6f8"><td colspan="2" style="font-weight:bold;text-align:center;color:var(--primary);padding:10px">Estado de Licencias</td></tr>`;
        html += (lics || []).map(l => `<tr>
            <td><strong>${l.nombre}</strong><br><small>ID: *** ${l.bloqueado ? '🚫 Bloqueado' : ''}</small></td>
            <td style="text-align:center;font-weight:bold;color:${l.dispositivos_usados >= 2 ? 'red' : 'green'}">${l.dispositivos_usados} / 2</td></tr>`).join('');
        html += `<tr style="background:#f4f6f8"><td colspan="2" style="font-weight:bold;text-align:center;color:var(--primary);padding:10px">Últimas Conexiones</td></tr>`;
        html += (logs || []).map(l => `<tr>
            <td>${new Date(l.created_at).toLocaleString('es-ES')}</td>
            <td style="font-size:0.8rem">${(l.device_info || '').replace(/\([^)]+\)/, '(***)')}</td></tr>`).join('');
        tbody.innerHTML = html;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="2" style="color:red;text-align:center">Error: ${e.message}</td></tr>`;
    }
}

export function checkAndInjectSessionButton() {
    const session = Storage.getSuspendedSession();
    const oldBtn = document.getElementById('btn-continue-session');
    if (oldBtn) oldBtn.remove(); // Limpiar previo

    if (session && session.currentQuestions && session.currentQuestions.length > 0) {
        const menuGrid = document.querySelector('#view-menu .menu-grid');

        const wrapper = document.createElement('div');
        wrapper.id = 'btn-continue-session';
        wrapper.style.gridColumn = '1 / -1';
        wrapper.style.position = 'relative';
        wrapper.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

        const btn = document.createElement('button');
        btn.className = 'btn-menu special';
        btn.style.width = '100%';
        btn.style.background = 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)';
        btn.style.color = '#fff';
        btn.style.boxShadow = '0 6px 15px rgba(13, 148, 136, 0.4)';
        btn.style.paddingRight = '3rem'; // Space for discard btn

        const total = session.currentQuestions.length;
        const current = session.currentIndex + 1;
        const pct = Math.round((current / total) * 100);

        btn.innerHTML = `
            <strong>▶️ Continuar Test en Pausa</strong>
            <div style="font-size: 0.85rem; margin-top: 5px; opacity: 0.9;">
                ${session.currentTopicName} - Pregunta ${current} de ${total}
            </div>
            <div style="width: 100%; background: rgba(255,255,255,0.3); height: 6px; border-radius: 3px; margin-top: 8px; overflow: hidden;">
                <div style="width: ${pct}%; background: #fff; height: 100%;"></div>
            </div>
        `;

        btn.addEventListener('click', () => {
            Game.restoreSession(session);
        });

        // ── Discard button ──────────────────────────────────────────────────
        const discardBtn = document.createElement('button');
        discardBtn.title = 'Descartar test en pausa';
        discardBtn.innerHTML = '🗑️';
        discardBtn.style.cssText = `
            position: absolute;
            top: 50%;
            right: 12px;
            transform: translateY(-50%);
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.4);
            border-radius: 6px;
            color: #fff;
            font-size: 1.1rem;
            cursor: pointer;
            padding: 4px 8px;
            line-height: 1;
            transition: background 0.2s;
            z-index: 2;
        `;
        discardBtn.addEventListener('mouseenter', () => {
            discardBtn.style.background = 'rgba(255,255,255,0.35)';
        });
        discardBtn.addEventListener('mouseleave', () => {
            discardBtn.style.background = 'rgba(255,255,255,0.2)';
        });
        discardBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // No disparar el "Continuar"
            Storage.clearSuspendedSession();
            // Transición suave antes de eliminar
            wrapper.style.opacity = '0';
            wrapper.style.transform = 'scaleY(0.8)';
            wrapper.style.overflow = 'hidden';
            setTimeout(() => wrapper.remove(), 300);
        });

        wrapper.appendChild(btn);
        wrapper.appendChild(discardBtn);
        if (menuGrid) menuGrid.insertBefore(wrapper, menuGrid.firstChild);
    }
}
