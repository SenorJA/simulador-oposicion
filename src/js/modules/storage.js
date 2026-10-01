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
    RECORDS: 'simulador_sescam_records',
    SESSION: 'estado_test_suspendido'
};

let currentPrefix = 'u_localdev_';
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
    // Aislamiento por usuario+rol: fallos, historial, récords y sesión suspendida
    if (key === KEYS.FAILED_IDS || key === KEYS.PROGRESS ||
        key === KEYS.RECORDS || key === KEYS.SESSION) {
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

// ── Última categoría elegida (preferencia por usuario, no por rol) ────────────

function roleKey() {
    const cleanId = currentUser ? currentUser.trim().toLowerCase().replace(/[^a-z0-9]/g, '') : 'localdev';
    return `u_${cleanId}_last_role`;
}

export function getLastRole() { return localStorage.getItem(roleKey()); }

export function setLastRole(role) {
    if (role === 'pinche' || role === 'celador') localStorage.setItem(roleKey(), role);
}

// ── Bienvenida (por navegador, no por usuario) ───────────────────────────────

const ONBOARDING_KEY = 'ope_onboarding_v1';
export function hasSeenOnboarding() { return localStorage.getItem(ONBOARDING_KEY) === '1'; }
export function markOnboardingSeen() { localStorage.setItem(ONBOARDING_KEY, '1'); }

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

// ── Guardado de Sesión Suspendida (aislada por usuario + rol) ─────────────
export function saveSuspendedSession(sessionData) {
    localStorage.setItem(pk(KEYS.SESSION), JSON.stringify(sessionData));
}

export function getSuspendedSession() {
    try {
        const raw = localStorage.getItem(pk(KEYS.SESSION));
        if (raw) return JSON.parse(raw);

        // Migración perezosa desde la clave legacy compartida (sin prefijo)
        const legacy = localStorage.getItem(KEYS.SESSION);
        if (legacy) {
            localStorage.setItem(pk(KEYS.SESSION), legacy);
            localStorage.removeItem(KEYS.SESSION);
            return JSON.parse(legacy);
        }
        return null;
    } catch {
        return null;
    }
}

export function clearSuspendedSession() {
    localStorage.removeItem(pk(KEYS.SESSION));
    localStorage.removeItem(KEYS.SESSION); // Limpiar también la legacy compartida
}

// ── Récords (High Scores, aislados por usuario + rol) ─────────────────────

/**
 * Obtiene el objeto de récords de localStorage.
 * Incluye migración perezosa desde las claves legacy (sin prefijo de usuario).
 */
export function getRecords() {
    const key = pk(KEYS.RECORDS);
    try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw) || {};
    } catch {
        return {};
    }

    // Migración perezosa desde las claves antiguas compartidas entre usuarios
    const legacyKey = currentRole === 'celador' ? KEYS.RECORDS + '_celador' : KEYS.RECORDS;
    try {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy) {
            localStorage.setItem(key, legacy);
            localStorage.removeItem(legacyKey);
            return JSON.parse(legacy) || {};
        }
    } catch { /* ignore */ }
    return {};
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
        localStorage.setItem(pk(KEYS.RECORDS), JSON.stringify(records));
        return true; // Récord actualizado
    }
    return false;
}

/**
 * Borra todos los récords de localStorage (del usuario y rol actuales).
 */
export function clearRecords() {
    localStorage.removeItem(pk(KEYS.RECORDS));
}
