/**
 * test_storage.js — Prueba funcional del aislamiento por usuario+rol.
 * Simula un localStorage en memoria (sin navegador) y verifica que los datos
 * de un usuario/rol no se mezclan con los de otro.
 * Uso: node scripts/test_storage.js
 */
const fs = require('fs');
const path = require('path');
// Re-lanza con --experimental-vm-modules si esta versión de Node lo exige
const vm = require('./vm-bootstrap.js');

// ── localStorage falso ─────────────────────────────────────────────────────
const store = new Map();
const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null
};

// ── Cargar storage.js como módulo ESM real ─────────────────────────────────
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/js/modules/storage.js'), 'utf8');
const mod = new vm.SourceTextModule(src, {
    identifier: 'storage.js',
    initializeImportMeta: (m) => { m.export = null; },
    context: vm.createContext({ localStorage, console, JSON, String, Object, Array, parseInt })
});
let fails = 0;
const ok = (c, msg, extra = '') => {
    console.log((c ? '  ✅ ' : '  ❌ ') + msg + (extra ? ' → ' + extra : ''));
    if (!c) fails++;
};

async function main() {
    await mod.link(() => { throw new Error('storage.js no debería importar nada'); });
    await mod.evaluate();
    const S = mod.namespace;

    console.log('=== A. Aislamiento de fallos entre usuarios ===');
    S.setPrefix('ALFA');
    S.addFailedId('q1'); S.addFailedId('q2');
    ok(S.getFailedIds().length === 2, 'ALFA tiene 2 fallos');

    S.setPrefix('BETA');
    ok(S.getFailedIds().length === 0, 'BETA no ve los fallos de ALFA');
    S.addFailedId('q9');
    ok(S.getFailedIds().join() === 'q9', 'BETA solo tiene los suyos');

    S.setPrefix('ALFA');
    ok(S.getFailedIds().join() === 'q1,q2', 'ALFA conserva los suyos al volver');
    console.log('  claves:', [...store.keys()].filter(k => k.includes('failed')).join(' | '));

    console.log('=== B. Aislamiento de rol (misma persona, pinche vs celador) ===');
    store.clear();
    S.setPrefix('ALFA'); S.setRole('pinche');
    S.addFailedId('soloPinche');
    S.setRole('celador');
    ok(S.getFailedIds().length === 0, 'celador no ve los fallos de pinche');
    S.addFailedId('soloCelador');
    S.setRole('pinche');
    ok(S.getFailedIds().join() === 'soloPinche', 'pinche conserva su lista sin el fallo de celador',
        S.getFailedIds().join());

    console.log('=== C. Récords aislados por usuario y rol ===');
    S.setPrefix('ALFA'); S.setRole('pinche');
    ok(S.saveRecord('ope_2026_pinche_ord', 7.5) === true, 'ALFA/pinche guarda récord 7.5');
    ok(S.saveRecord('ope_2026_pinche_ord', 6.0) === false, 'no baja un récord existente');
    ok(S.saveRecord('ope_2026_pinche_ord', 9.25) === true, 'sube a 9.25');
    S.setRole('celador');
    ok(Object.keys(S.getRecords()).length === 0, 'celador no ve los récords de pinche');
    S.saveRecord('ope_2026_celador', 5);
    S.setRole('pinche');
    ok(S.getRecords()['ope_2026_pinche_ord'] === 9.25, 'pinche recupera su récord');
    ok(S.getRecords()['ope_2026_celador'] === undefined, 'pinche no ve el récord de celador');

    console.log('=== D. Migración perezosa desde claves legacy ===');
    store.clear();
    localStorage.setItem('simulador_sescam_records', JSON.stringify({ legacy: 8 }));
    localStorage.setItem('estado_test_suspendido', JSON.stringify({ currentQuestions: ['legacy-q'] }));
    S.setPrefix('NUEVO'); S.setRole('pinche');
    ok(S.getRecords().legacy === 8, 'adopta los récords legacy');
    ok(localStorage.getItem('simulador_sescam_records') === null, 'borra la clave legacy de récords');
    ok(S.getSuspendedSession() && S.getSuspendedSession().currentQuestions[0] === 'legacy-q', 'adopta la sesión legacy');
    ok(localStorage.getItem('estado_test_suspendido') === null, 'borra la clave legacy de sesión');
    ok(localStorage.getItem('u_nuevo_estado_test_suspendido') !== null, 'la copia vive ya prefijada',
        [...store.keys()].filter(k => k.includes('suspendido')).join(' | '));

    console.log('=== E. Limpieza de fallos (usada por la migración v2) ===');
    store.clear();
    S.setPrefix('ALFA'); S.setRole('pinche');
    S.addFailedId('antiguo');
    S.addFailedId('antiguo2');
    S.clearFailures();
    ok(S.getFailedIds().length === 0, 'clearFailures vacía el rol actual');
    S.setRole('celador');
    S.addFailedId('celadorFallo');
    S.setRole('pinche'); S.addFailedId('otro');
    S.clearFailures();
    S.setRole('celador');
    ok(S.getFailedIds().join() === 'celadorFallo', 'clearFailures no toca el otro rol');

    console.log('=== F. Save/clear de sesión ===');
    store.clear();
    S.setPrefix('ALFA'); S.setRole('pinche');
    S.saveSuspendedSession({ currentQuestions: [1, 2, 3], currentIndex: 1 });
    S.setRole('celador');
    ok(S.getSuspendedSession() === null, 'celador no ve la sesión en pausa de pinche');
    S.setRole('pinche');
    ok(S.getSuspendedSession().currentIndex === 1, 'pinche recupera su sesión');
    S.clearSuspendedSession();
    ok(S.getSuspendedSession() === null, 'clearSuspendedSession la borra');

    console.log('\n' + (fails === 0 ? '✅ AISLAMIENTO CORRECTO' : `❌ ${fails} FALLOS`));
    process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('Error en la prueba:', e); process.exit(1); });
