/**
 * storage.js — LocalStorage helpers for failures and progress history.
 */

const KEYS = {
    FAILED_IDS: 'ope_failed_ids',
    DUDOSAS: 'ope_dudosas',
    PROGRESS: 'ope_progress',
    ANSWERED: 'ope_answered',
    USER_ACCESS: 'ope_user_access',
    TOKEN: 'ope_token',
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
    // Aislamiento por usuario+rol: fallos, dudosas, historial, récords, sesión
    if (key === KEYS.FAILED_IDS || key === KEYS.DUDOSAS || key === KEYS.PROGRESS ||
        key === KEYS.RECORDS || key === KEYS.SESSION || key === KEYS.ANSWERED) {
        return currentPrefix + key;
    }
    return key;
}

// ── Estadísticas (preguntas respondidas y racha) ─────────────────────────────

export function incrementAnswered(n = 1) {
    const v = parseInt(localStorage.getItem(pk(KEYS.ANSWERED)) || '0', 10) + n;
    localStorage.setItem(pk(KEYS.ANSWERED), String(v));
    return v;
}
export function getAnsweredTotal() {
    return parseInt(localStorage.getItem(pk(KEYS.ANSWERED)) || '0', 10);
}

// La racha es de la persona, no del rol: clave por usuario (sin rol).
const streakKey = () => userPrefix() + 'ope_streak';
const streakDateKey = () => userPrefix() + 'ope_streak_date';

/** Actualiza la racha de días seguidos. Devuelve la racha actual. */
export function touchStreak() {
    const hoy = new Date().toISOString().slice(0, 10);
    const ultimo = localStorage.getItem(streakDateKey());
    let racha = parseInt(localStorage.getItem(streakKey()) || '0', 10);

    if (ultimo === hoy) return racha;
    if (!ultimo) {
        racha = 1;
    } else {
        const d = new Date(ultimo + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        racha = d.toISOString().slice(0, 10) === hoy ? racha + 1 : 1;
    }
    localStorage.setItem(streakDateKey(), hoy);
    localStorage.setItem(streakKey(), String(racha));
    return racha;
}
export function getStreak() {
    return parseInt(localStorage.getItem(streakKey()) || '0', 10);
}

// ── Preguntas marcadas como dudosas ──────────────────────────────────────────

export function getDudosas() {
    try { return JSON.parse(localStorage.getItem(pk(KEYS.DUDOSAS))) || []; }
    catch { return []; }
}

export function isDudosa(id) { return getDudosas().includes(id); }

/** Marca/desmarca una pregunta. Devuelve true si queda marcada. */
export function toggleDudosa(id) {
    const set = new Set(getDudosas());
    if (set.has(id)) set.delete(id); else set.add(id);
    localStorage.setItem(pk(KEYS.DUDOSAS), JSON.stringify([...set]));
    return set.has(id);
}

/** Vacía por completo la lista de dudosas del usuario+rol actual. */
export function clearDudosas() {
    localStorage.removeItem(pk(KEYS.DUDOSAS));
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

export function saveUser(id) { localStorage.setItem(KEYS.USER_ACCESS, id); }
/** Olvida el usuario y su token (para "Cambiar de usuario") sin tocar el device id. */
export function forgetUser() {
    localStorage.removeItem(KEYS.USER_ACCESS);
    forgetToken();
}

// ── Token de sesión (emitido por la Edge Function `login`) ───────────────────
export function getToken() {
    return localStorage.getItem(KEYS.TOKEN) || sessionStorage.getItem(KEYS.TOKEN);
}
/** `remember` = true → sesión persistente; false → solo dura la pestaña. */
export function setToken(token, remember = true) {
    if (!token) return;
    if (remember) {
        localStorage.setItem(KEYS.TOKEN, token);
        sessionStorage.removeItem(KEYS.TOKEN);
    } else {
        sessionStorage.setItem(KEYS.TOKEN, token);
        localStorage.removeItem(KEYS.TOKEN);
    }
}
export function forgetToken() {
    localStorage.removeItem(KEYS.TOKEN);
    sessionStorage.removeItem(KEYS.TOKEN);
}

// ── Usuario recordado (solo el nombre; NUNCA la contraseña) ──────────────────
const REMEMBER_KEY = 'ope_remember_user';
export function getRememberedUser() { return localStorage.getItem(REMEMBER_KEY); }
export function setRememberedUser(user) {
    if (user) localStorage.setItem(REMEMBER_KEY, user);
    else localStorage.removeItem(REMEMBER_KEY);
}

// ── Última categoría elegida (preferencia por usuario, no por rol) ────────────

function roleKey() {
    return userPrefix() + 'last_role';
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
/** Borra TODO el progreso del usuario+rol: fallos, dudosas, historial,
 *  récords, estadísticas y la racha. No toca la sesión de licencia. */
export function clearAllProgress() {
    [KEYS.FAILED_IDS, KEYS.DUDOSAS, KEYS.PROGRESS, KEYS.RECORDS, KEYS.ANSWERED]
        .forEach(k => localStorage.removeItem(pk(k)));
    localStorage.removeItem(streakKey());
    localStorage.removeItem(streakDateKey());
}

// ── Backup: exportar / importar los datos del usuario ─────────────────────

/** Prefijo de las claves del usuario actual (ambos roles comparten prefijo base). */
function userPrefix() {
    const cleanId = currentUser ? currentUser.trim().toLowerCase().replace(/[^a-z0-9]/g, '') : 'localdev';
    return `u_${cleanId}_`;
}

/** Todas las claves de localStorage del usuario actual (fallos, récords, sesión…). */
export function exportUserData() {
    const pref = userPrefix();
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(pref)) data[k] = localStorage.getItem(k);
    }
    return data;
}

/**
 * Restaura un backup. Solo acepta claves con el prefijo del usuario actual,
 * así un backup no puede escribir datos de otra cuenta ni claves ajenas.
 * @returns {number} cuántas claves se restauraron
 */
export function importUserData(data) {
    if (!data || typeof data !== 'object') return 0;
    const pref = userPrefix();
    let n = 0;
    for (const [k, v] of Object.entries(data)) {
        if (typeof k === 'string' && typeof v === 'string' && k.startsWith(pref)) {
            localStorage.setItem(k, v);
            n++;
        }
    }
    return n;
}
