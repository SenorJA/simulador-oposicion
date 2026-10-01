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
    // ── Tema (claro/oscuro) recordado en el navegador ──────────────────────
    initTheme();

    // ── Sincronización periódica del progreso (si hay sesión) ──────────────
    setInterval(() => { syncProgress(); }, 60000);
    window.addEventListener('pagehide', () => { syncProgress(); });

    // ── Diálogos accesibles: Escape cierra, Tab queda atrapado dentro ──────
    setupDialogA11y();

    // ── PWA: cachea el shell para permitir instalación y arranque offline ──
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(() => { /* sin SW no pasa nada */ });
        });
    }

    // ── Auth flow ──────────────────────────────────────────────────────────
    prefillUserFromUrl();
    setupLoginForm();

    Auth.checkAuth({ onDenied: handleAuthDenied, onSuccess: handleAuthSuccess });

    // ── Browsing History Fix ──
    window.onpopstate = (event) => {
        if (event.state && event.state.view) {
            UI.showView(event.state.view, false);
        }
    };
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Actualiza el contador de preguntas marcadas como dudosas. */
function updateDudosasBadge() {
    const el = document.getElementById('badge-dudosas');
    if (el) el.textContent = Storage.getDudosas().length;
}

/** Aplica y recuerda el tema (claro/oscuro). */
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('ope_theme', theme); } catch { /* ignore */ }
}

function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('ope_theme'); } catch { /* ignore */ }
    document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark';
}

/** Sincroniza el progreso con el servidor (la fusión la hace el servidor). */
async function syncProgress() {
    const token = Storage.getToken();
    if (!token) return;
    try {
        const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/sync-progress`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: CONFIG.SUPABASE_KEY,
                Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`
            },
            body: JSON.stringify({ token, data: Storage.exportUserData() })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.ok !== true || !j.data) return;
        Storage.importUserData(j.data);
        UI.updateFailureBadge(Storage.getFailedIds().length);
        updateDudosasBadge();
        UI.renderizarRecordsMenu();
    } catch { /* offline: se reintentará */ }
}

/**
 * Acceso denegado: muestra el overlay con el motivo (o un login neutro).
 */
function handleAuthDenied(msg) {
    const overlay = document.getElementById('access-overlay');
    if (overlay) overlay.classList.remove('hidden');
    const spinner = document.getElementById('access-spinner');
    if (spinner) spinner.classList.add('hidden');

    const sinSesion = /Introduce tu/i.test(msg || '');
    const titleEl = document.getElementById('access-title');
    const msgEl = document.getElementById('access-msg');
    if (titleEl) {
        titleEl.innerText = sinSesion ? 'Inicia sesión' : 'Acceso Denegado';
        titleEl.style.color = sinSesion ? '' : 'red';
    }
    if (msgEl) msgEl.innerText = sinSesion ? 'Introduce tu usuario y contraseña.' : msg;

    const input = document.getElementById('access-code-input');
    if (input) input.focus();
}

/**
 * Acceso correcto: carga los bancos y arranca la app.
 */
function handleAuthSuccess(_userData, _currentDevices, _maxDevices) {
    // El overlay sigue visible (con el spinner) hasta cargar los bancos.
    const msgEl = document.getElementById('access-msg');
    if (msgEl) msgEl.innerText = 'Cargando preguntas…';

    const isAdmin = (_userData.id_acceso === CONFIG.ADMIN_USER);
    UI.toggleEl('btn-admin-panel', isAdmin);
    console.log(`[AUTH] User: ${_userData.id_acceso} | Admin: ${isAdmin}`);

    const licEl = document.getElementById('licencia-activa');
    if (licEl) {
        licEl.textContent = '✓ Conectado como ' + _userData.id_acceso;
        licEl.style.display = 'inline-block';
    }
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.classList.remove('hidden');

    Data.loadAllData().then(questions => {
        if (questions.length === 0) {
            showFatalDataError(Data.getLastLoadReport());
            return;
        }

        const overlay = document.getElementById('access-overlay');
        if (overlay) overlay.classList.add('hidden');

        // Migración única de IDs antiguos
        if (Storage.getVersionData() !== 'v2_unique_ids') {
            Storage.clearFailures();
            Storage.setVersionData('v2_unique_ids');
        }

        UI.updateFailureBadge(Storage.getFailedIds().length);
        updateDudosasBadge();
        UI.renderizarRecordsMenu();
        UI.renderizarProgresoGlobal();
        UI.renderizarProgresoExamenes();
        Storage.touchStreak();
        setupEventListeners();
        syncProgress();

        const lastRole = Storage.getLastRole();
        if (lastRole === 'pinche' || lastRole === 'celador') {
            UI.showView('roleSelection', false);
            selectRole(lastRole);
        } else {
            UI.showView('roleSelection', false);
        }

        if (!Storage.hasSeenOnboarding()) {
            UI.toggleEl('onboarding-modal', true);
        }
    });
}

/** Rellena el usuario desde ?user= o desde el recordado, y limpia la URL. */
function prefillUserFromUrl() {
    const input = document.getElementById('access-code-input');
    const password = document.getElementById('access-password-input');
    const params = new URLSearchParams(window.location.search);
    const urlUser = params.get('user');

    if (input) input.value = urlUser || Storage.getRememberedUser() || '';
    if (urlUser) window.history.replaceState({}, document.title, window.location.pathname);
    if (input && input.value && password) password.focus();
}

/**
 * Accesibilidad de los modales: al abrirse mueve el foco dentro de ellos y lo
 * mantiene atrapado (Tab/Shift+Tab); al cerrarse lo devuelve a donde estaba.
 * Escape cierra el diálogo visible usando su propio botón de cierre.
 */
function setupDialogA11y() {
    const DIALOGS = ['admin-modal', 'nav-grid-overlay', 'onboarding-modal'];
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
            const cerrar = dlg.querySelector('#btn-close-admin, #btn-close-grid, #btn-close-onboarding');
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
 * Muestra un aviso breve (toast) no bloqueante en la parte inferior.
 */
function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'toast';
        t.className = 'toast';
        t.setAttribute('role', 'status');
        t.setAttribute('aria-live', 'polite');
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/**
 * Cierra la bienvenida y recuerda que ya se ha visto.
 */
function closeOnboarding() {
    Storage.markOnboardingSeen();
    UI.toggleEl('onboarding-modal', false);
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
    const spinner = document.getElementById('access-spinner');
    if (spinner) spinner.classList.add('hidden');
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
function setupLoginForm() {
    const input = document.getElementById('access-code-input');
    const password = document.getElementById('access-password-input');
    const btn = document.getElementById('btn-access-retry');
    const toggle = document.getElementById('btn-toggle-password');
    const remember = document.getElementById('access-remember');
    if (!input || !password || !btn) return;

    // Ojo: ver / ocultar contraseña
    if (toggle) {
        toggle.addEventListener('click', () => {
            const ver = password.type === 'password';
            password.type = ver ? 'text' : 'password';
            toggle.setAttribute('aria-pressed', String(ver));
            toggle.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
            toggle.textContent = ver ? '🙈' : '👁️';
            password.focus();
        });
    }

    const submit = async () => {
        const user = input.value.trim();
        if (!user) { input.focus(); return; }
        if (!password.value) { password.focus(); return; }

        btn.disabled = true;
        const spinner = document.getElementById('access-spinner');
        if (spinner) spinner.classList.remove('hidden');
        const msgEl = document.getElementById('access-msg');
        if (msgEl) msgEl.innerText = 'Verificando…';

        await Auth.loginWithPassword(user, password.value, {
            onDenied: handleAuthDenied,
            onSuccess: handleAuthSuccess,
            remember: remember ? remember.checked : true
        });
        btn.disabled = false;
    };

    btn.addEventListener('click', submit);
    [input, password].forEach(el => el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
    }));
}

/**
 * Selección de categoría (pinche | celador).
 * La Parte General (Temas 1-6) es común a ambas categorías: se comparten
 * las mismas preguntas, pero el progreso se almacena aislado por rol.
 */
function selectRole(role) {
    state.currentRole = role;
    Storage.setRole(role);
    Storage.setLastRole(role);

    // Vaciar memoria local de fallos y estado al cambiar
    state.userAnswers = {};
    state.currentQuestions = [];

    const menuTitle = document.querySelector('#view-menu h1');
    if (menuTitle) menuTitle.innerText = role === 'celador' ? 'Simulador OPE Celador' : 'Simulador OPE Pinche';

    // Forzar actualización reactiva (cada rol tiene sus propios datos aislados)
    UI.updateFailureBadge(Storage.getFailedIds().length);
    updateDudosasBadge();
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

/** Ignora clics repetidos muy seguidos (evita arrancar el mismo test dos veces). */
function sinDoble(fn, ms = 600) {
    let ultimo = 0;
    return (...args) => {
        const ahora = Date.now();
        if (ahora - ultimo < ms) return;
        ultimo = ahora;
        return fn(...args);
    };
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
    setupAdminActions();
    on('btn-admin-new', 'click', async () => {
        const id = (prompt('Código de usuario (letras/números, sin espacios):') || '').trim();
        if (!id) return;
        const nombre = prompt('Nombre (opcional):') || id;
        const password = prompt('Contraseña (mínimo 6 caracteres):');
        if (!password) return;
        if (password.length < 6) { alert('La contraseña debe tener al menos 6 caracteres.'); return; }
        try {
            renderAdminTable(await callAdmin({ action: 'create', id_acceso: id, nombre, password }));
            showToast('Usuario creado ✓');
        } catch (e) {
            alert('Error: ' + e.message);
        }
    });
    on('btn-close-admin', 'click', () => UI.toggleEl('admin-modal', false));
    on('btn-close-onboarding', 'click', closeOnboarding);
    on('btn-onboarding-ok', 'click', closeOnboarding);

    // ── Cambiar de usuario (cerrar sesión) ──
    on('btn-logout', 'click', () => {
        if (confirm('¿Cambiar de usuario? Se cerrará la sesión actual.')) {
            Storage.forgetUser();
            const url = new URL(window.location.href);
            url.searchParams.delete('user');
            window.location.href = url.toString();
        }
    });

    // ── Tema claro/oscuro ──
    on('btn-theme', 'click', () => {
        applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
    });

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

    // ── Dudosas (marcar y repasar) ──
    on('btn-dudosa', 'click', () => {
        const q = state.currentQuestions[state.currentIndex];
        if (!q) return;
        const marcada = Storage.toggleDudosa(q.id);
        const btn = document.getElementById('btn-dudosa');
        if (btn) {
            btn.classList.toggle('marked', marcada);
            btn.setAttribute('aria-pressed', String(marcada));
            btn.textContent = marcada ? '🔖 Marcada' : '☆ Marcar dudosa';
        }
        updateDudosasBadge();
        showToast(marcada ? 'Marcada como dudosa 🔖' : 'Desmarcada');
    });
    on('btn-dudosas', 'click', () => {
        const ids = new Set(Storage.getDudosas());
        const qs = state.allQuestions.filter(q => ids.has(q.id));
        if (qs.length === 0) { alert('No tienes preguntas marcadas como dudosas.'); return; }
        Game.startGame(qs, 'training', 'Repaso de dudosas');
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
    on('btn-mode-training', 'click', sinDoble(() => triggerGameStart('training')));
    on('btn-mode-exam', 'click', sinDoble(() => triggerGameStart('exam')));

    // ── Timer Toggle ──
    // El cronómetro del simulacro se configura con #exam-count / #exam-time
    // (ver triggerGameStart).

    // ── Random config ──
    on('btn-back-random', 'click', () => UI.goBack());
    on('btn-start-random', 'click', sinDoble(startRandom));

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
    on('btn-export-data', 'click', exportProgress);
    on('btn-import-data', 'click', () => {
        const input = document.getElementById('import-file');
        if (input) input.click();
    });
    on('import-file', 'change', (e) => importProgressFile(e.target.files && e.target.files[0]));

    // ── Game controls ──
    on('btn-quit-game', 'click', () => {
        if (confirm('¿Salir al menú? Tu test actual quedará guardado automáticamente.')) {
            Game.stopTimer(); // Detener cronómetro (sin borrar el tiempo guardado)
            showToast('Progreso guardado ✓');
            checkAndInjectSessionButton(); // Refresca UI
            UI.goBack(); 
        }
    });
    on('btn-next', 'click', () => Game.nextQuestion());
    on('btn-prev', 'click', () => Game.prevQuestion());
    on('btn-show-grid', 'click', () => Game.showGrid());
    on('btn-toggle-fullview', 'click', () => Game.toggleFullView());
    on('btn-close-grid', 'click', () => UI.toggleEl('nav-grid-overlay', false));

    // ── Atajos de teclado durante el test (1-4 responder, ←/→ navegar) ──
    document.addEventListener('keydown', (e) => {
        const gameView = document.getElementById('view-game');
        if (!gameView || !gameView.classList.contains('active')) return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const tag = (e.target && e.target.tagName) || '';
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;

        if (/^[1-4]$/.test(e.key)) {
            const opciones = [...document.querySelectorAll('#view-game .btn-option:not([disabled])')]
                .filter(b => b.offsetParent !== null);
            const btn = opciones[parseInt(e.key, 10) - 1];
            if (btn) { e.preventDefault(); btn.click(); }
        } else if (e.key === 'ArrowRight') {
            const next = document.getElementById('btn-next');
            if (next && !next.classList.contains('hidden')) { e.preventDefault(); next.click(); }
        } else if (e.key === 'ArrowLeft') {
            const prev = document.getElementById('btn-prev');
            if (prev && !prev.classList.contains('hidden')) { e.preventDefault(); prev.click(); }
        }
    });

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
    let qs = state.pendingGameGenerator();
    if (!qs || qs.length === 0) { alert('No hay preguntas para este test.'); return; }

    let customSeconds = null;
    if (mode === 'exam') {
        // Nº de preguntas (0 = todas)
        const countSel = document.getElementById('exam-count');
        const count = countSel ? parseInt(countSel.value, 10) : 0;
        if (count > 0 && count < qs.length) {
            qs = [...qs].sort(() => 0.5 - Math.random()).slice(0, count);
        }
        // Tiempo por pregunta (0 = sin límite: el cronómetro cuenta hacia arriba)
        const timeSel = document.getElementById('exam-time');
        const minsPerQ = timeSel ? parseFloat(timeSel.value) : 1;
        state.timerEnabled = minsPerQ > 0;
        customSeconds = minsPerQ > 0 ? Math.round(qs.length * minsPerQ * 60) : null;
    }

    state.currentMode = mode;
    state.originalMode = mode;
    Game.startGame(qs, mode, state.pendingTopicTitle || 'Test', state.pendingTestId, customSeconds);
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
    renderTopicStats();
    renderFailuresList();
    renderStatsSummary();
    UI.showView('progress');
}

/** Escapa texto para poder inyectarlo con innerHTML sin romper el HTML. */
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/** Estadísticas de dominio por tema (fallos pendientes / total). */
function renderTopicStats() {
    const cont = document.getElementById('topic-stats');
    if (!cont) return;
    const failed = new Set(Storage.getFailedIds());
    const grupos = {};
    for (const q of state.allQuestions) {
        const nombre = q.origen || q.source || 'Otros';
        const g = grupos[nombre] || (grupos[nombre] = { total: 0, fallidas: 0 });
        g.total++;
        if (failed.has(q.id)) g.fallidas++;
    }
    const filas = Object.entries(grupos)
        .map(([n, g]) => ({ n, total: g.total, fallidas: g.fallidas }))
        .filter(f => f.fallidas > 0)
        .sort((a, b) => b.fallidas - a.fallidas);

    if (filas.length === 0) {
        cont.innerHTML = '<p class="setting-hint">Sin fallos pendientes. 🏆 ¡Todo dominado!</p>';
        return;
    }
    cont.innerHTML = filas.map(f => {
        const pct = Math.round(((f.total - f.fallidas) / f.total) * 100);
        return `
            <div class="topic-stat">
                <span class="ts-name">${escapeHtml(f.n)}</span>
                <span class="ts-bar-bg"><span class="ts-bar" style="width:${pct}%"></span></span>
                <span class="ts-pct">${f.fallidas} fallo${f.fallidas === 1 ? '' : 's'}</span>
            </div>`;
    }).join('');
}

/** Lista de preguntas actualmente falladas, para repasarlas. */
function renderFailuresList() {
    const cont = document.getElementById('failures-list');
    if (!cont) return;
    const failed = new Set(Storage.getFailedIds());
    const items = state.allQuestions.filter(q => failed.has(q.id));
    if (items.length === 0) {
        cont.innerHTML = '<p class="setting-hint">No tienes fallos pendientes. 🏆</p>';
        return;
    }
    cont.innerHTML = items.slice(0, 10).map(q => `
        <div class="failure-item">
            <div class="fi-meta">${escapeHtml(q.origen || '')} · ${escapeHtml(q.tema || '')}</div>
            <div>${escapeHtml(q.pregunta)}</div>
            <div class="fi-meta">Correcta: ${escapeHtml(String(q.correcta).toUpperCase())}</div>
        </div>`).join('')
        + (items.length > 10 ? `<p class="setting-hint">… y ${items.length - 10} más.</p>` : '');
}

/** Resumen de actividad: respondidas, racha, fallos, dudosas y evolución. */
function renderStatsSummary() {
    const cont = document.getElementById('stats-summary');
    if (!cont) return;

    const total = Storage.getAnsweredTotal();
    const racha = Storage.getStreak();
    const fallos = Storage.getFailedIds().length;
    const dudosas = Storage.getDudosas().length;
    const history = Storage.getHistory().slice(0, 12).reverse(); // de antiguo a reciente
    const barras = history
        .map(h => `<span class="stat-bar" style="height:${Math.max(8, h.pct)}%" title="${h.pct}%"></span>`)
        .join('');

    cont.innerHTML = `
        <div class="stat-grid">
            <div class="stat"><span class="stat-num">${total}</span><span class="stat-lbl">respondidas</span></div>
            <div class="stat"><span class="stat-num">${racha}</span><span class="stat-lbl">días seguidos</span></div>
            <div class="stat"><span class="stat-num">${fallos}</span><span class="stat-lbl">fallos pendientes</span></div>
            <div class="stat"><span class="stat-num">${dudosas}</span><span class="stat-lbl">dudosas</span></div>
        </div>
        ${history.length ? `<div class="stat-chart">${barras}</div><p class="setting-hint">Evolución de los últimos ${history.length} test${history.length === 1 ? '' : 's'}</p>` : ''}`;
}

/** Descarga el progreso del usuario actual como archivo JSON. */
function exportProgress() {
    const data = Storage.exportUserData();
    const payload = JSON.stringify({ app: 'ope-sescam', version: 1, data }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ope-sescam-progreso-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Progreso exportado ✓');
}

/** Restaura el progreso desde un archivo JSON exportado. */
function importProgressFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(reader.result);
            const data = parsed && parsed.data ? parsed.data : parsed;
            const n = Storage.importUserData(data);
            if (n === 0) { alert('El archivo no contiene datos válidos para este usuario.'); return; }
            showToast(`Progreso importado (${n}) ✓`);
            UI.updateFailureBadge(Storage.getFailedIds().length);
            showProgress();
        } catch {
            alert('No se pudo leer el archivo de progreso.');
        }
    };
    reader.readAsText(file);
}

// ── Admin panel ────────────────────────────────────────────────────────────

/** Llama a la Edge Function admin-logs (leer o ejecutar una acción). */
async function callAdmin(payload) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/admin-logs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: CONFIG.SUPABASE_KEY,
            Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`
        },
        body: JSON.stringify({ token: Storage.getToken(), ...payload })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok !== true) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
}

/** Pinta la tabla del panel de administración. */
function renderAdminTable(j) {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;
    const lics = j.licenses || [];
    const logs = j.logs || [];

    let html = '<tr class="admin-sep"><td colspan="3">Estado de Licencias</td></tr>';
    html += lics.map(l => `<tr>
        <td><strong>${escapeHtml(l.nombre || '')}</strong><br><small>${escapeHtml(l.id_acceso)} ${l.bloqueado ? '🚫 Bloqueado' : ''}</small></td>
        <td class="admin-count ${l.dispositivos_usados >= 2 ? 'score-bad' : 'score-good'}">${l.dispositivos_usados} / 2</td>
        <td class="admin-actions">
            <button class="admin-btn" data-action="${l.bloqueado ? 'unblock' : 'block'}" data-id="${escapeHtml(l.id_acceso)}">${l.bloqueado ? 'Desbloquear' : 'Bloquear'}</button>
            <button class="admin-btn" data-action="reset_password" data-id="${escapeHtml(l.id_acceso)}">Contraseña</button>
            <button class="admin-btn" data-action="reset_devices" data-id="${escapeHtml(l.id_acceso)}">Dispositivos</button>
        </td></tr>`).join('');
    html += '<tr class="admin-sep"><td colspan="3">Últimas Conexiones</td></tr>';
    html += logs.map(l => `<tr><td colspan="2">${new Date(l.created_at).toLocaleString('es-ES')}</td>
        <td class="admin-log">${escapeHtml((l.device_info || '').replace(/\([^)]+\)/, '(***)'))}</td></tr>`).join('');
    tbody.innerHTML = html;
}

async function loadAdminLogs() {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center">Cargando...</td></tr>';
    UI.toggleEl('admin-modal', true);
    try {
        renderAdminTable(await callAdmin({}));
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--error)">No autorizado: ${escapeHtml(e.message)}</td></tr>`;
    }
}

/** Acciones del panel (delegación en el tbody). */
function setupAdminActions() {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;
    tbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('.admin-btn');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const payload = { action, id_acceso: id };

        if (action === 'reset_password') {
            const p = prompt(`Nueva contraseña para ${id} (mínimo 6):`);
            if (!p) return;
            if (p.length < 6) { alert('La contraseña debe tener al menos 6 caracteres.'); return; }
            payload.password = p;
        } else {
            const msgs = {
                block: `¿Bloquear a ${id}? No podrá entrar.`,
                unblock: `¿Desbloquear a ${id}?`,
                reset_devices: `¿Liberar los dispositivos de ${id}? Podrá entrar desde 2 dispositivos nuevos.`
            };
            if (!confirm(msgs[action] || '¿Continuar?')) return;
        }

        btn.disabled = true;
        try {
            renderAdminTable(await callAdmin(payload));
            showToast('Hecho ✓');
        } catch (err) {
            alert('Error: ' + err.message);
            btn.disabled = false;
        }
    });
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
