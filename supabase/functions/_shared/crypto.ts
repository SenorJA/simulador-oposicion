/**
 * _shared/crypto.ts — Utilidades compartidas por las Edge Functions.
 *
 * - Verificación de contraseñas con PBKDF2 (Web Crypto, sin dependencias).
 * - Token de sesión firmado con HMAC-SHA256 usando un secreto que solo existe
 *   en el servidor (la service_role). El navegador nunca ve el secreto.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToB64Url(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64UrlToBytes(b64: string): Uint8Array {
    const norm = (b64 || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = norm + '='.repeat((4 - (norm.length % 4)) % 4);
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function igualdadSegura(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

export async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
    );
    return new Uint8Array(bits);
}

/** Comprueba `password` contra el hash guardado (`pbkdf2$iter$saltB64$hashB64`). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const p = (stored || '').split('$');
    if (p.length !== 4 || p[0] !== 'pbkdf2') return false;
    const iter = parseInt(p[1], 10);
    if (!iter || iter < 1000) return false;
    const salt = b64UrlToBytes(p[2]);
    const hash = bytesToB64Url(await pbkdf2(password, salt, iter));
    return igualdadSegura(hash, p[3]);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
    );
}

/** Firma un token de sesión para `user` con caducidad en ms. */
export async function signToken(user: string, secret: string, ttlMs = 12 * 60 * 60 * 1000): Promise<string> {
    const payload = bytesToB64Url(encoder.encode(JSON.stringify({ u: user, e: Date.now() + ttlMs })));
    const key = await hmacKey(secret);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
    return `${payload}.${bytesToB64Url(sig)}`;
}

/** Devuelve el usuario si el token es válido y no ha caducado; si no, null. */
export async function verifyToken(token: string, secret: string): Promise<string | null> {
    const [payload, sig] = (token || '').split('.');
    if (!payload || !sig) return null;
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, b64UrlToBytes(sig), encoder.encode(payload));
    if (!ok) return null;
    try {
        const data = JSON.parse(decoder.decode(b64UrlToBytes(payload)));
        if (!data.u || typeof data.e !== 'number' || Date.now() > data.e) return null;
        return String(data.u);
    } catch {
        return null;
    }
}
