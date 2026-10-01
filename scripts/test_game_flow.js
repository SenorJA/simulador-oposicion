/**
 * test_game_flow.js — Prueba funcional del FLUJO NORMAL de un test (sin vista
 * completa): startGame, responder, navegar, finalizar, historial y récords.
 *
 * Usa state.js real y ui.js/storage.js simulados, con un DOM mínimo.
 * Complementa a test_fullview.js (que cubre la vista completa).
 *
 * Uso: node scripts/test_game_flow.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('./vm-bootstrap.js');

const ROOT = path.join(__dirname, '..');

let fails = 0;
const ok = (c, msg, extra = '') => {
    console.log((c ? '  ✅ ' : '  ❌ ') + msg + (extra ? ' → ' + extra : ''));
    if (!c) fails++;
};

// ── Fake DOM ───────────────────────────────────────────────────────────────
class FakeClassList {
    constructor() { this.s = new Set(); }
    add(...c) { c.forEach(x => this.s.add(x)); }
    remove(...c) { c.forEach(x => this.s.delete(x)); }
    contains(c) { return this.s.has(c); }
    toggle(c, f) { if (f === undefined) f = !this.s.has(c); f ? this.s.add(c) : this.s.delete(c); }
}
class FakeEl {
    constructor(tag = 'div') {
        this.tagName = tag; this.parent = null; this.children = [];
        this.classList = new FakeClassList(); this.style = {}; this.dataset = {};
        this.disabled = false; this.listeners = {}; this.attrs = {};
        this._innerHTML = ''; this._textContent = '';
    }
    set className(v) { this._className = v; this.classList = new FakeClassList(); String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
    get className() { return this._className || ''; }
    set innerHTML(v) { this._innerHTML = v; if (v === '' || v == null) this.children = []; }
    get innerHTML() { return this._innerHTML; }
    set textContent(v) { this._textContent = v; }
    get textContent() { return this._textContent; }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter(x => x !== c); }
    remove() { if (this.parent) this.parent.removeChild(this); }
    replaceWith(nuevo) {
        if (!this.parent) return;
        const i = this.parent.children.indexOf(this);
        if (i >= 0) { nuevo.parent = this.parent; this.parent.children[i] = nuevo; }
    }
    cloneNode() {
        const c = new FakeEl(this.tagName);
        c._className = this._className;
        this.classList.s.forEach(x => c.classList.add(x));
        c._innerHTML = this._innerHTML; c.disabled = this.disabled;
        return c;
    }
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    click() { (this.listeners.click || []).forEach(f => f({ target: this, preventDefault() {} })); }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    scrollIntoView() {}
}

// ── Preguntas: P1 correcta 'b', P2 correcta 'a' ────────────────────────────
const QUESTIONS = () => ([
    { id: 'q1', tema: 'Tema 3', pregunta: 'P1', opciones: { a: 'A', b: 'B', c: 'C' }, correcta: 'b' },
    { id: 'q2', tema: 'Tema 4', pregunta: 'P2', opciones: { a: 'A', b: 'B', c: 'C' }, correcta: 'a' }
]);

/** Carga game.js real con ui/storage simulados. */
async function loadGame() {
    const elements = {};
    const failed = new Set();
    const state = { history: [], records: {} };
    const ui = { views: [], toggles: [], badges: [] };

    const document = {
        createElement: (t) => new FakeEl(t),
        getElementById: (id) => elements[id] || (elements[id] = new FakeEl('div')),
        querySelector: (sel) => elements['qs:' + sel] || (elements['qs:' + sel] = new FakeEl('div')),
        querySelectorAll: () => []
    };

    const StorageMock = {
        addFailedId: (id) => failed.add(id),
        removeFailedId: (id) => failed.delete(id),
        getFailedIds: () => [...failed],
        saveSuspendedSession: () => {},
        clearSuspendedSession: () => {},
        getSuspendedSession: () => null,
        addHistoryEntry: (e) => state.history.push(e),
        saveRecord: (id, score) => { const nuevo = !(id in state.records) || score > state.records[id]; state.records[id] = score; return nuevo; }
    };

    const ctx = vm.createContext({
        console, JSON, Math, Object, Array, String, Number, Boolean, Set, Map, parseInt, parseFloat, Date,
        document, alert: () => {}, setTimeout: () => 0, clearTimeout: () => {},
        setInterval: () => 0, clearInterval: () => {},
        showView: (v) => ui.views.push(v),
        toggleEl: (id, v) => ui.toggles.push([id, v]),
        updateFailureBadge: (n) => ui.badges.push(n)
    });

    const realModule = (file) => new vm.SourceTextModule(
        fs.readFileSync(path.join(ROOT, file), 'utf8'),
        { identifier: file, context: ctx }
    );

    const stateMod = realModule('src/js/modules/state.js');
    await stateMod.link(() => { throw new Error('state.js no importa nada'); });
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

    return { G: gameMod.namespace, state: stateMod.namespace.state, failed, ui, elements, storage: state };
}

const botones = (elements) => elements['opciones-container'].children;
const porLetra = (elements, L) => botones(elements).find(b => b.innerHTML.charAt(b.innerHTML.indexOf(')') - 1).toLowerCase() === L);

async function main() {
    console.log('=== 1. startGame: reset y primer render ===');
    {
        const { G, state, ui, elements } = await loadGame();
        G.startGame(QUESTIONS(), 'training', 'Test', 't1');
        ok(state.currentIndex === 0, 'empieza en la primera pregunta');
        ok(state.score === 0, 'score a 0');
        ok(Object.keys(state.userAnswers).length === 0, 'sin respuestas previas');
        ok(botones(elements).length === 3, 'renderiza 3 opciones', String(botones(elements).length));
        ok(elements['pregunta-texto'].textContent === 'P1', 'muestra el enunciado');
        ok(elements['question-counter'].textContent === '1/2', 'contador 1/2');
        ok(ui.views.includes('game'), 'navega a la vista de juego');
    }

    console.log('=== 2. Training: acierto y feedback ===');
    {
        const { G, state, failed, elements } = await loadGame();
        G.startGame(QUESTIONS(), 'training', 'Test');
        porLetra(elements, 'b').click();
        ok(state.score === 1, 'suma el acierto', String(state.score));
        ok(state.userAnswers[0] === 'b', 'guarda la respuesta');
        ok(!failed.has('q1'), 'no registra fallo');
        ok(!elements['feedback'].classList.contains('hidden'), 'muestra el feedback');
        ok(!elements['btn-next'].classList.contains('hidden'), 'aparece el botón Siguiente');
        ok(botones(elements).every(b => b.disabled), 'bloquea las opciones');
        ok(porLetra(elements, 'b').classList.contains('correct'), 'marca la correcta');
    }

    console.log('=== 3. Training: fallo ===');
    {
        const { G, failed, elements } = await loadGame();
        G.startGame(QUESTIONS(), 'training', 'Test');
        porLetra(elements, 'a').click();
        ok(failed.has('q1'), 'registra el fallo en el historial');
        ok(porLetra(elements, 'b').classList.contains('correct'), 'revela la correcta');
        ok(porLetra(elements, 'a').classList.contains('incorrect'), 'marca la elegida');
    }

    console.log('=== 4. Navegación next/prev ===');
    {
        const { G, state, elements } = await loadGame();
        G.startGame(QUESTIONS(), 'exam', 'Test');
        G.nextQuestion();
        ok(state.currentIndex === 1, 'avanza a la pregunta 2', String(state.currentIndex));
        ok(elements['opciones-container'].children.length === 3, 're-renderiza las opciones');
        G.prevQuestion();
        ok(state.currentIndex === 0, 'retrocede a la 1');
    }

    console.log('=== 5. Fin de test en training: historial y récord ===');
    {
        const { G, state, elements, storage } = await loadGame();
        G.startGame(QUESTIONS(), 'training', 'Mi test', 't1');
        porLetra(elements, 'b').click(); // correcta
        G.nextQuestion();
        porLetra(elements, 'a').click(); // correcta
        G.nextQuestion(); // última → finaliza
        ok(elements !== null && storage.history.length === 1, 'guarda 1 entrada de historial', String(storage.history.length));
        ok(storage.history[0] && storage.history[0].topic.includes('[Entrenamiento]'), 'la entrada es de Entrenamiento', storage.history[0] && storage.history[0].topic);
        ok(storage.records['t1'] === 10, 'récord = 10/10', String(storage.records['t1']));
        ok(elements['score-badge'] !== undefined, 'sigue habiendo UI');
    }

    console.log('=== 6. Examen: puntuación penalizada (acierto - fallo/3) ===');
    {
        const { G, elements, storage } = await loadGame();
        G.startGame(QUESTIONS(), 'exam', 'Examen', 't2');
        porLetra(elements, 'b').click(); // q1 correcta
        G.nextQuestion();
        porLetra(elements, 'b').click(); // q2 incorrecta (correcta a)
        G.nextQuestion(); // finaliza
        ok(elements['final-score'].textContent === '0.67', 'nota neta 1 - 1/3 = 0.67', elements['final-score'].textContent);
        ok(storage.history[0].topic.includes('[Examen]'), 'historial marcado como Examen');
    }

    console.log('=== 7. Sin preguntas: no arranca ===');
    {
        const { G, state, ui } = await loadGame();
        G.startGame([], 'training', 'Vacío');
        ok(!ui.views.includes('game'), 'no navega a juego con pool vacío');
    }

    console.log('\n' + (fails === 0 ? '✅ FLUJO DE TEST CORRECTO' : `❌ ${fails} FALLOS`));
    process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error('Error en la prueba:', e); process.exit(1); });
