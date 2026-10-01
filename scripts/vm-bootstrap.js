/**
 * vm-bootstrap.js — Re-lanza el script actual con --experimental-vm-modules.
 *
 * `vm.SourceTextModule` sigue siendo una API experimental, así que en algunas
 * versiones de Node hay que pasar el flag a mano. Esto permite que
 * `node scripts/test_storage.js` funcione sin recordarlo.
 *
 * Uso (al principio del test, antes de tocar `vm`):
 *   require('./vm-bootstrap.js');
 */
const vm = require('vm');

if (typeof vm.SourceTextModule !== 'function') {
    const { spawnSync } = require('child_process');
    // process.argv[1] es el script de entrada. Ojo: __filename aquí es este
    // mismo bootstrap, así que habría que re-lanzarlo a sí mismo en bucle.
    const entry = process.argv[1];
    const result = spawnSync(
        process.execPath,
        ['--experimental-vm-modules', entry, ...process.argv.slice(2)],
        { stdio: 'inherit' }
    );
    process.exit(result.status === null ? 1 : result.status);
}

module.exports = vm;
