/**
 * auth.js — Acceso con usuario + contraseña.
 *
 * La contraseña se verifica en la Edge Function `login` (NUNCA en el cliente),
 * que devuelve un token de sesión firmado. Ese token es el que usa `get-bank`
 * para servir los bancos. El límite de 2 dispositivos sigue gestionándose aquí
 * sobre `usuarios_acceso` / `access_logs`.
 */
import { state } from './state.js';
import { CONFIG } from './config.js';
import * as Storage from './storage.js';

const MAX_DEVICES = 2;

function initSupabase() {
    if (window.supabase && !state.supabaseClient) {
        state.supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
    }
}

function showAccessDenied(msg) {
    const titleEl = document.getElementById('access-title');
    const msgEl = document.getElementById('access-msg');
    if (titleEl) { titleEl.innerText = 'Acceso Denegado'; titleEl.style.color = 'red'; }
    if (msgEl) msgEl.innerText = msg;
    const overlay = document.getElementById('access-overlay');
    if (overlay) overlay.classList.remove('hidden');
    Storage.clearUser();
}

/** Llama a la Edge Function `login` (usuario+contraseña o token). */
async function callLogin(body) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: CONFIG.SUPABASE_KEY,
            Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`
        },
        body: JSON.stringify(body)
    });
    let j = {};
    try { j = await res.json(); } catch { /* respuesta sin JSON */ }
    if (!res.ok || j.ok !== true) {
        const e = new Error(j.error || `HTTP ${res.status}`);
        e.status = res.status;
        throw e;
    }
    return j;
}

/**
 * Tras validar usuario+contraseña (o el token): comprueba/actualiza el contador
 * de dispositivos y llama a `onSuccess`.
 */
async function finalizeAccess(data, { onSuccess, onDenied }) {
    const exactId = data.id_acceso;
    Storage.saveUser(exactId);
    Storage.setPrefix(exactId);

    const { id: deviceId } = Storage.getOrCreateDeviceId();
    const shortId = deviceId.substring(0, 10);
    let currentDBCount = data.dispositivos_usados || 0;

    const registeredDeviceId = localStorage.getItem('ope_reg_v2_' + exactId);
    let isRegisteredLocally = (registeredDeviceId === deviceId);
    if (currentDBCount === 0) isRegisteredLocally = false;

    let needsIncrement = !isRegisteredLocally;

    // Auto-recuperación: si el contador de la DB es incoherente, se apoya en logs
    if (isRegisteredLocally && currentDBCount < MAX_DEVICES) {
        try {
            const { data: lastLogs } = await state.supabaseClient
                .from(CONFIG.TABLE_LOGS)
                .select('device_info')
                .ilike('device_info', `%(${exactId})%`)
                .order('created_at', { ascending: false })
                .limit(1);

            if (lastLogs && lastLogs.length > 0) {
                const lastInfo = lastLogs[0].device_info || '';
                const lastDevId = lastInfo.split(' — ').pop().trim();
                if (lastDevId && lastDevId !== shortId) {
                    console.log(`[AUTH] Cambio de dispositivo detectado (${lastDevId} -> ${shortId}). Reparando contador…`);
                    needsIncrement = true;
                }
            }
        } catch (e) {
            console.warn('[AUTH] Error en self-healing check:', e);
        }
    }

    if (needsIncrement) {
        if (currentDBCount >= MAX_DEVICES && !isRegisteredLocally) {
            onDenied(`Acceso denegado. Esta licencia ya ha alcanzado el límite máximo de ${MAX_DEVICES} dispositivos permitidos.`);
            Storage.clearUser();
            Storage.forgetToken();
            return;
        }

        if (currentDBCount < MAX_DEVICES) {
            const newCount = currentDBCount + 1;
            const { data: updateData, error: updateError } = await state.supabaseClient
                .from(CONFIG.TABLE_USERS)
                .update({ dispositivos_usados: newCount })
                .eq('id_acceso', exactId)
                .select();

            if (updateError) {
                console.error('[AUTH] Error Update:', updateError);
            } else if (updateData && updateData.length > 0) {
                currentDBCount = updateData[0].dispositivos_usados;
                localStorage.setItem('ope_reg_v2_' + exactId, deviceId);
                console.log(`[AUTH] DB Reparada/Incrementada: ${currentDBCount}/${MAX_DEVICES}`);
            }
        }
    }

    // Log de acceso
    try {
        const regStatus = isRegisteredLocally ? 'Old' : 'NEW';
        const trace = `V:${CONFIG.APP_VERSION.split(' ')[0]} [DB:${data.dispositivos_usados},Reg:${regStatus},Inc:${needsIncrement ? 'Y' : 'N'}]`;
        await state.supabaseClient.from(CONFIG.TABLE_LOGS).insert([{
            created_at: new Date().toISOString(),
            status: 'success',
            device_info: `${data.nombre} (${data.id_acceso}) — ${currentDBCount}/${MAX_DEVICES} — ${trace} — ${shortId}`
        }]);
    } catch (e) { console.warn('Log error:', e); }

    onSuccess(data, currentDBCount, MAX_DEVICES);
}

/**
 * Acceso con usuario + contraseña (lo llama el formulario de login).
 */
export async function loginWithPassword(user, password, { onSuccess, onDenied, remember = true }) {
    initSupabase();
    if (!state.supabaseClient) { onDenied('Error: Supabase no inicializado.'); return; }

    try {
        const j = await callLogin({ user, password });
        Storage.setToken(j.token, remember);
        Storage.setRememberedUser(remember ? user : null);
        await finalizeAccess(
            { id_acceso: j.user, nombre: j.nombre || j.user, bloqueado: false, dispositivos_usados: j.dispositivos_usados || 0 },
            { onSuccess, onDenied }
        );
    } catch (e) {
        onDenied(e.message || 'No se pudo iniciar sesión.');
    }
}

/**
 * Comprueba la sesión guardada (token) al abrir la app. Si no hay sesión o ha
 * caducado, llama a `onDenied` para mostrar el login.
 */
export async function checkAuth({ onSuccess, onDenied }) {
    initSupabase();

    const token = Storage.getToken();
    if (!token) {
        onDenied('Introduce tu usuario y contraseña.');
        return;
    }

    try {
        const j = await callLogin({ token });
        await finalizeAccess(
            { id_acceso: j.user, nombre: j.nombre || j.user, bloqueado: false, dispositivos_usados: j.dispositivos_usados || 0 },
            { onSuccess, onDenied }
        );
    } catch {
        Storage.forgetToken();
        onDenied('Tu sesión ha caducado. Vuelve a entrar.');
    }
}

/**
 * Registra un evento de acceso.
 */
export async function logAccess(userId, detail) {
    if (!state.supabaseClient) return;
    try {
        await state.supabaseClient.from(CONFIG.TABLE_LOGS).insert([{
            created_at: new Date().toISOString(),
            status: 'success',
            device_info: detail
        }]);
    } catch (e) { console.warn('logAccess error:', e); }
}
