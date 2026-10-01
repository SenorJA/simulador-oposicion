/**
 * auth.js — Acceso con usuario + contraseña.
 *
 * La contraseña se verifica en la Edge Function `login` (NUNCA en el cliente).
 * Esa función también registra el dispositivo (límite 2, de forma atómica) y
 * devuelve un token firmado. Ese token es el que usa `get-bank`.
 *
 * Con RLS activo, el navegador NO lee ni escribe ninguna tabla directamente:
 * todo pasa por las Edge Functions con la service_role.
 */
import { CONFIG } from './config.js';
import * as Storage from './storage.js';

const MAX_DEVICES = 2;

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

function finalizeAccess(data, { onSuccess }) {
    Storage.saveUser(data.id_acceso);
    Storage.setPrefix(data.id_acceso);
    onSuccess(data, data.dispositivos_usados || 0, MAX_DEVICES);
}

/** Acceso con usuario + contraseña (lo llama el formulario de login). */
export async function loginWithPassword(user, password, { onSuccess, onDenied, remember = true }) {
    try {
        const { id: deviceId } = Storage.getOrCreateDeviceId();
        const j = await callLogin({ user, password, deviceId });
        Storage.setToken(j.token, remember);
        Storage.setRememberedUser(remember ? user : null);
        finalizeAccess(
            { id_acceso: j.user, nombre: j.nombre || j.user, bloqueado: false, dispositivos_usados: j.dispositivos_usados || 0 },
            { onSuccess }
        );
    } catch (e) {
        onDenied(e.message || 'No se pudo iniciar sesión.');
    }
}

/** Comprueba la sesión guardada (token) al abrir la app. */
export async function checkAuth({ onSuccess, onDenied }) {
    const token = Storage.getToken();
    if (!token) {
        onDenied('Introduce tu usuario y contraseña.');
        return;
    }
    try {
        const { id: deviceId } = Storage.getOrCreateDeviceId();
        const j = await callLogin({ token, deviceId });
        finalizeAccess(
            { id_acceso: j.user, nombre: j.nombre || j.user, bloqueado: false, dispositivos_usados: j.dispositivos_usados || 0 },
            { onSuccess }
        );
    } catch {
        Storage.forgetToken();
        onDenied('Tu sesión ha caducado. Vuelve a entrar.');
    }
}
