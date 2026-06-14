/**
 * storage.js — LocalStorage helpers for failures and progress history.
 */
/**
 * storage.js — LocalStorage helpers for failures and progress history.
 */

const KEYS = {
    FAILED_IDS: 'ope_failed_ids',
    PROGRESS: 'ope_progress',
    USER_ACCESS: 'ope_user_access',
    DEVICE_ID: 'ope_device_id',
    DEVICE_REGISTERED: 'ope_device_registered', // Legacy
    VERSION_DATA: 'ope_version_data',
    RECORDS: 'simulador_sescam_records'
};

let currentPrefix = '';
let currentUser = '';
let currentRole = 'pinche';

export function setPrefix(userId) {
    currentUser = userId;
    updatePrefix();
}

export function setRole(role) {
    currentRole = role;
    updatePrefix();
}

function updatePrefix() {
    // Si no hay usuario definido, usamos un prefijo seguro por defecto para local
    const cleanId = currentUser ? currentUser.trim().toLowerCase().replace(/[^a-z0-9]/g, '') : 'localdev';
    
    if (currentRole === 'celador') {
        // Prefijo exclusivo para celador
        currentPrefix = `u_${cleanId}_celador_`;
    } else {
        // Prefijo original de Pinche
        // Se añade un "_" extra si cleanId existe para mantener compatibilidad
        currentPrefix = currentUser ? `u_${cleanId}_` : `u_localdev_`;
    }
}

function pk(key) {
    if (key === KEYS.FAILED_IDS || key === KEYS.PROGRESS) {
        return currentPrefix + key;
    }
    return key;
}

// ── Failures ─────────────────────────────────────────────────────────────────

export function getFailedIds() {
    try {
        const key = pk(KEYS.FAILED_IDS);
        // Aislamiento explícito para evitar que Pinche lea fallos de Celador 
        // en caso de problemas con el prefijo o keys compartidas
        if (currentRole === 'pinche' && key.includes('_celador_')) {
            return [];
        }
        return JSON.parse(localStorage.getItem(key)) || [];
    }
    catch { return []; }
}

export function addFailedId(id) {
    const ids = getFailedIds();
    const set = new Set(ids);
    if (!set.has(id)) {
        ids.push(id);
        localStorage.setItem(pk(KEYS.FAILED_IDS), JSON.stringify(ids));
    }
}

export function removeFailedId(id) {
    const ids = getFailedIds().filter(x => x !== id);
    localStorage.setItem(pk(KEYS.FAILED_IDS), JSON.stringify(ids));
}

export function clearFailures() {
    localStorage.removeItem(pk(KEYS.FAILED_IDS));
}

// ── Progress History ──────────────────────────────────────────────────────────

export function getHistory() {
    try { return JSON.parse(localStorage.getItem(pk(KEYS.PROGRESS))) || []; }
    catch { return []; }
}

export function addHistoryEntry(entry) {
    const history = getHistory();
    history.unshift(entry);
    if (history.length > 50) history.pop();
    localStorage.setItem(pk(KEYS.PROGRESS), JSON.stringify(history));
}

export function clearHistory() {
    localStorage.removeItem(pk(KEYS.PROGRESS));
}

// ── User / Device ─────────────────────────────────────────────────────────────

export function getSavedUser() { return localStorage.getItem(KEYS.USER_ACCESS); }
export function saveUser(id) { localStorage.setItem(KEYS.USER_ACCESS, id); }
export function clearUser() {
    localStorage.removeItem(KEYS.USER_ACCESS);
    localStorage.removeItem(KEYS.DEVICE_ID);
    localStorage.removeItem(KEYS.DEVICE_REGISTERED);
}

export function getDeviceRegisteredFor() { return localStorage.getItem(KEYS.DEVICE_REGISTERED); }
export function setDeviceRegisteredFor(val) { localStorage.setItem(KEYS.DEVICE_REGISTERED, val); }

export function getOrCreateDeviceId() {
    let id = localStorage.getItem(KEYS.DEVICE_ID);
    if (!id) {
        id = 'dev_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem(KEYS.DEVICE_ID, id);
        return { id, isNew: true };
    }
    return { id, isNew: false };
}

export function getVersionData() { return localStorage.getItem(KEYS.VERSION_DATA); }
export function setVersionData(val) { localStorage.setItem(KEYS.VERSION_DATA, val); }

// ── Guardado de Sesión Suspendida ──────────────────────────────────────────
export function saveSuspendedSession(sessionData) {
    localStorage.setItem('estado_test_suspendido', JSON.stringify(sessionData));
}

export function getSuspendedSession() {
    try { 
        return JSON.parse(localStorage.getItem('estado_test_suspendido')); 
    } catch { 
        return null; 
    }
}

export function clearSuspendedSession() {
    localStorage.removeItem('estado_test_suspendido');
}

// ── Récords (High Scores) ──────────────────────────────────────────────────

/**
 * Obtiene el objeto de récords de localStorage.
 */
export function getRecords() {
    try {
        const key = currentRole === 'celador' ? KEYS.RECORDS + '_celador' : KEYS.RECORDS;
        return JSON.parse(localStorage.getItem(key)) || {};
    } catch {
        return {};
    }
}

/**
 * Guarda un récord si la nota es mayor a la anterior.
 * @param {string} testId 
 * @param {number} score 
 */
export function saveRecord(testId, score) {
    if (!testId) return;
    const records = getRecords();
    const currentRecord = records[testId] || 0;

    if (score > currentRecord) {
        records[testId] = parseFloat(score.toFixed(2));
        const key = currentRole === 'celador' ? KEYS.RECORDS + '_celador' : KEYS.RECORDS;
        localStorage.setItem(key, JSON.stringify(records));
        return true; // Récord actualizado
    }
    return false;
}

/**
 * Borra todos los récords de localStorage.
 */
export function clearRecords() {
    const key = currentRole === 'celador' ? KEYS.RECORDS + '_celador' : KEYS.RECORDS;
    localStorage.removeItem(key);
}
