/**
 * test_fullview.js — Prueba funcional de renderFullView() en sus 3 modos.
 * Usa un DOM mínimo simulado (sin navegador) para verificar:
 *  - training/failures: una sola respuesta, suma a score, registra/perdona fallos
 *  - exam: re-clicable, sin score ni registro de fallos
 *  - review: todo bloqueado, muestra correcta + elección previa
 *  - re-render: una pregunta ya respondida aparece bloqueada y coloreada
 *
 * Cada caso carga una instancia nueva de game.js porque `_fullViewActive` es
 * estado privado del módulo y debe empezar en false en cada escenario.
 *
 * Uso: node scripts/test_fullview.js
 */
const fs = require('fs');
const path = require('path');
// Re-lanza con --experimental-vm-modules si esta versión de Node lo exige
const vm = require('./vm-bootstrap.js');

const ROOT = path.join(__dirname, '..');

// ── Fake DOM mínimo ────────────────────────────────────────────────────────
class FakeClassList {
    constructor() { this.s = new Set(); }
    add(...c) { c.forEach(x => this.s.add(x)); }
    remove(...c) { c.forEach(x => this.s.delete(x)); }
    contains(c) { return this.s.has(c); }
    toggle(c, f) { if (f === undefined) f = !this.s.has(c); f ? this.s.add(c) : this.s.delete(c); }
}
class FakeEl {
    constructor(tag) {
        this.tagName = tag; this.children = []; this.classList = new FakeClassList();
        this._innerHTML = ''; this._textContent = ''; this.dataset = {}; this.style = {};
        this.disabled = false; this.listeners = {};
    }
    set className(v) { this._className = v; String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
    get className() { return this._className || ''; }
    set innerHTML(v) { this._innerHTML = v; }
    get innerHTML() { return this._innerHTML; }
    set textContent(v) { this._textContent = v; }
    get textContent() { return this._textContent; }
    appendChild(c) { this.children.push(c); return c; }
    remove() {}
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    click() { (this.listeners.click || []).forEach(f => f({ target: this, preventDefault() {} })); }
}

let fails = 0;
const ok = (c, msg, extra = '') => {
    console.log((c ? '  ✅ ' : '  ❌ ') + msg + (extra ? ' → ' + extra : ''));
    if (!c) fails++;
};

// ── Preguntas de prueba ────────────────────────────────────────────────────
// P1 correcta = 'b' | P2 correcta = 'a'
const QUESTIONS = () => ([
    { id: 'q1', tema: 'Tema 1', pregunta: 'P1', opciones: { a: 'A', b: 'B', c: 'C' }, correcta: 'b' },
    { id: 'q2', tema: 'Tema 2', pregunta: 'P2', opciones: { a: 'A', b: 'B', c: 'C' }, correcta: 'a' }
]);

/**
 * Carga game.js con state.js real y ui.js/storage.js simulados.
 * Devuelve { G, state, failed, uiCalls, elements }.
 */
async function loadGame({ mode = 'training', answers = {}, failed: initialFailed = [] } = {}) {
    const elements = {};
    const failed = new Set(initialFailed);
    const uiCalls = { views: [], toggles: [], badges: [] };

    const document = {
        createElement: (t) => new FakeEl(t),
        // Siempre un elemento memoizado: el toggle de salida llama a renderQuestion()
        getElementById: (id) => elements[id] || (elements[id] = new FakeEl('div')),
        querySelector: (sel) => elements['qs:' + sel] || (elements['qs:' + sel] = new FakeEl('div')),
        querySelectorAll: () => []
    };

    const StorageMock = {
        addFailedId: (id) => failed.add(id),
        removeFailedId: (id) => failed.delete(id),
        getFailedIds: () => [...failed],
        isDudosa: () => false,
        incrementAnswered: () => {},
        saveSuspendedSession: () => {},
        clearSuspendedSession: () => {},
        getSuspendedSession: () => null
    };

    const ctx = vm.createContext({
        console, JSON, Math, Object, Array, String, Number, Boolean, Set, Map, parseInt, parseFloat,
        document,
        setInterval: () => 0, clearInterval: () => {}, alert: () => {},
        showView: (v) => uiCalls.views.push(v),
        toggleEl: (id, v) => uiCalls.toggles.push([id, v]),
        updateFailureBadge: (n) => uiCalls.badges.push(n)
    });

    const realModule = (file) => new vm.SourceTextModule(
        fs.readFileSync(path.join(ROOT, file), 'utf8'),
        { identifier: file, initializeImportMeta: (m) => { m.export = null; }, context: ctx }
    );

    const stateMod = realModule('src/js/modules/state.js');
    await stateMod.link(() => { throw new Error('state.js no debería importar nada'); });
    await stateMod.evaluate();

    const gameMod = realModule('src/js/modules/game.js');
    await gameMod.link((dep) => {
        if (dep === './state.js') return stateMod;
        if (dep === './ui.js') {
            return new vm.SyntheticModule(['showView', 'toggleEl', 'updateFailureBadge'], function () {
                this.setExport('showView', ctx.showView);
                this.setExport('toggleEl', ctx.toggleEl);
                this.setExport('updateFailureBadge', ctx.updateFailureBadge);
            }, { context: ctx, identifier: 'ui.js' });
        }
        if (dep === './storage.js') {
            return new vm.SyntheticModule(Object.keys(StorageMock), function () {
                for (const k of Object.keys(StorageMock)) this.setExport(k, StorageMock[k]);
            }, { context: ctx, identifier: 'storage.js' });
        }
        throw new Error('import inesperado: ' + dep);
    });
    await gameMod.evaluate();

    const state = stateMod.namespace.state;
    state.currentMode = mode;
    state.currentQuestions = QUESTIONS();
    state.userAnswers = { ...answers };
    state.score = 0;

    return { G: gameMod.namespace, state, failed, uiCalls, elements };
}

// ── Helpers de aserción sobre el DOM renderizado ───────────────────────────
const letterOf = (b) => b.innerHTML.charAt(b.innerHTML.indexOf(')') - 1).toLowerCase();
function view(elements) {
    const fv = elements['full-exam-view'];
    const optsOf = (i) => fv.children[i].children[2].children;
    return {
        container: fv,
        cards: fv.children.slice(0, 2),
        finishBtn: fv.children[2],
        optsOf,
        labels: (i) => optsOf(i).map(letterOf),
        byLetter: (i, L) => optsOf(i).find(b => letterOf(b) === L),
        colored: (i) => optsOf(i).filter(b => b.classList.contains('correct') || b.classList.contains('incorrect'))
    };
}

async function main() {
    console.log('=== 1. TRAINING: respuesta incorrecta ===');
    {
        const { G, state, failed, uiCalls, elements } = await loadGame({ mode: 'training' });
        G.toggleFullView();
        const v = view(elements);
        ok(v.cards.length === 2, 'renderiza 2 tarjetas de pregunta');
        ok(v.finishBtn.classList.contains('full-view-finish-btn'), 'añade el botón Finalizar al final');
        ok(v.labels(0).join() === 'a,b,c', 'opciones en orden a,b,c', v.labels(0).join());

        v.byLetter(0, 'a').click(); // incorrecta (correcta = b)
        ok(state.userAnswers[0] === 'a', 'registra la respuesta elegida');
        ok(state.score === 0, 'no suma aciertos');
        ok(failed.has('q1'), 'añade el fallo al historial');
        ok(uiCalls.badges.length === 1 && uiCalls.badges[0] === 1, 'actualiza el contador de fallos', String(uiCalls.badges));
        ok(v.optsOf(0).every(b => b.disabled), 'bloquea todas las opciones de esa pregunta');
        ok(v.byLetter(0, 'b').classList.contains('correct'), 'marca la correcta en verde');
        ok(v.byLetter(0, 'a').classList.contains('incorrect'), 'marca la elegida en rojo');
        ok(v.colored(0).length === 2, 'colorea exactamente 2 opciones', String(v.colored(0).length));
        ok(elements['score-badge'].textContent === 'Aciertos: 0', 'sincroniza el badge de aciertos', elements['score-badge'].textContent);
        ok(!v.optsOf(1).every(b => b.disabled), 'la otra pregunta sigue respondible');
    }

    console.log('=== 2. TRAINING: segundo clic no cambia nada ===');
    {
        const { G, state, elements } = await loadGame({ mode: 'training' });
        G.toggleFullView();
        const v = view(elements);
        v.byLetter(0, 'a').click();
        v.byLetter(0, 'c').click();
        ok(state.userAnswers[0] === 'a', 'no sobrescribe una respuesta ya hecha');
        ok(v.byLetter(0, 'c').disabled, 'la opción neutral sigue bloqueada');
        ok(state.score === 0, 'no puntúa dos veces');
    }

    console.log('=== 3. TRAINING: respuesta correcta + auto-perdón ===');
    {
        const { G, state, failed, elements } = await loadGame({ mode: 'training', failed: ['q2'] });
        G.toggleFullView();
        view(elements).byLetter(1, 'a').click(); // correcta
        ok(state.score === 1, 'suma el acierto', String(state.score));
        ok(!failed.has('q2'), 'perdona el fallo previo (removeFailedId)');
    }

    console.log('=== 4. EXAM: re-clicable, sin score ni fallos ===');
    {
        const { G, state, failed, elements } = await loadGame({ mode: 'exam' });
        G.toggleFullView();
        const v = view(elements);
        v.byLetter(0, 'c').click();
        ok(state.userAnswers[0] === 'c', 'registra la selección');
        v.byLetter(0, 'a').click();
        ok(state.userAnswers[0] === 'a', 'permite cambiarla antes de enviar');
        ok(v.byLetter(0, 'a').classList.contains('exam-selected'), 'resalta la nueva selección');
        ok(!v.byLetter(0, 'c').classList.contains('exam-selected'), 'quita el resaltado anterior');
        ok(v.optsOf(0).every(b => !b.disabled), 'no bloquea opciones en modo examen');
        ok(state.score === 0, 'no puntúa en modo examen');
        ok(failed.size === 0, 'no registra fallos en modo examen');
    }

    console.log('=== 5. REVIEW: bloqueado, muestra correcta + elección previa ===');
    {
        const { G, state, elements } = await loadGame({ mode: 'review', answers: { 0: 'a', 1: 'b' } });
        G.toggleFullView();
        const v = view(elements);
        ok(v.optsOf(0).every(b => b.disabled), 'todas las opciones bloqueadas');
        ok(v.byLetter(0, 'b').classList.contains('correct'), 'P1 muestra la correcta');
        ok(v.byLetter(0, 'a').classList.contains('incorrect'), 'P1 marca la fallada');
        ok(v.byLetter(1, 'a').classList.contains('correct'), 'P2 muestra la correcta');
        ok(v.byLetter(1, 'b').classList.contains('incorrect'), 'P2 marca la fallada');
        v.byLetter(0, 'c').click();
        ok(state.userAnswers[0] === 'a', 'revisar no permite responder');
        ok(state.score === 0, 'revisar no puntúa');
    }

    console.log('=== 6. Re-render en TRAINING con respuesta previa ===');
    {
        const { G, state, failed, elements } = await loadGame({ mode: 'training', answers: { 0: 'a' }, failed: ['q1'] });
        G.toggleFullView();
        const v = view(elements);
        ok(v.byLetter(0, 'b').classList.contains('correct'), 'la correcta sale verde al reabrir');
        ok(v.byLetter(0, 'a').classList.contains('incorrect'), 'la fallada sale roja al reabrir');
        ok(v.optsOf(0).every(b => b.disabled), 'no se puede volver a responder');
        v.byLetter(0, 'b').click();
        ok(state.score === 0, 'no vuelve a puntuar', String(state.score));
        ok(failed.has('q1'), 'no borra el fallo previo al reabrir');
        ok(!v.byLetter(0, 'b').classList.contains('incorrect'), 'acertar en revisión no la marca como fallada');
    }

    console.log('=== 7. Modo fallos: se comporta como training ===');
    {
        const { G, state, failed, elements } = await loadGame({ mode: 'failures' });
        G.toggleFullView();
        const v = view(elements);
        v.byLetter(1, 'b').click(); // incorrecta (correcta = a)
        ok(failed.has('q2'), 'registra el fallo');
        ok(v.byLetter(1, 'a').classList.contains('correct'), 'revela la correcta');
        ok(state.score === 0, 'no puntúa el fallo');
    }

    console.log('\n' + (fails === 0 ? '✅ VISTA COMPLETA CORRECTA EN LOS 3 MODOS' : `❌ ${fails} FALLOS`));
    process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error('Error en la prueba:', e); process.exit(1); });
