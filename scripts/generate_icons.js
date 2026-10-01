/**
 * generate_icons.js — Genera los iconos PNG del PWA (sin dependencias).
 *
 * Dibuja una cruz blanca sobre fondo teal (identidad sanitaria del SESCAM)
 * con supersampling para bordes suaves y escribe PNG válidos con zlib.
 *
 * Uso: node scripts/generate_icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'icons');
const TEAL = [0, 137, 123];
const WHITE = [255, 255, 255];

// ¿El punto (x,y) está dentro de un rectángulo redondeado?
function inRoundRect(x, y, rx0, ry0, w, h, r) {
    const cx = rx0 + w / 2, cy = ry0 + h / 2;
    const ax = Math.abs(x - cx) - (w / 2 - r);
    const ay = Math.abs(y - cy) - (h / 2 - r);
    const dist = Math.min(Math.max(ax, ay), 0) + Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) - r;
    return dist <= 0;
}

/** Devuelve [r,g,b,a] con a en 0..1 del diseño a escala `size`. */
function sample(size, x, y, maskable) {
    const r = 0.22 * size;                       // radio de las esquinas
    const fondo = maskable
        ? true                                    // maskable: fondo a sangre
        : inRoundRect(x, y, 0, 0, size, size, r);

    if (!fondo) return [0, 0, 0, 0];

    // Cruz centrada. En maskable se encoge para respetar la zona segura (~80%)
    const k = maskable ? 0.5 : 0.64;
    const armW = 0.18 * size * (maskable ? 0.78 : 1);
    const armL = k * size;
    const c = size / 2;
    const barra = (cx, cy, w, h, rad) => inRoundRect(x, y, cx - w / 2, cy - h / 2, w, h, rad);
    const enCruz =
        barra(c, c, armW, armL, armW / 2) ||
        barra(c, c, armL, armW, armW / 2);

    return enCruz ? [...WHITE, 1] : [...TEAL, 1];
}

/** Rasteriza con supersampling y devuelve un buffer RGBA. */
function raster(k, size, maskable, ss = 4) {
    const out = Buffer.alloc(size * size * 4);
    const step = 1 / ss;
    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            let a = 0, r = 0, g = 0, b = 0;
            for (let sy = 0; sy < ss; sy++) {
                for (let sx = 0; sx < ss; sx++) {
                    const [cr, cg, cb, ca] = sample(size, px + (sx + 0.5) * step, py + (sy + 0.5) * step, maskable);
                    a += ca;
                    r += cr * ca; g += cg * ca; b += cb * ca;
                }
            }
            const n = ss * ss;
            const alpha = a / n;
            const i = (py * size + px) * 4;
            out[i] = alpha ? Math.round(r / a) : 0;
            out[i + 1] = alpha ? Math.round(g / a) : 0;
            out[i + 2] = alpha ? Math.round(b / a) : 0;
            out[i + 3] = Math.round(alpha * 255);
        }
    }
    return out;
}

// ── Codificador PNG mínimo ───────────────────────────────────────────────────
const CRC_TABLE = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const cuerpo = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo), 0);
    return Buffer.concat([len, cuerpo, crc]);
}
function png(size, rgba) {
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0; // filtro none
        rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

fs.mkdirSync(OUT, { recursive: true });
const trabajos = [
    [192, false, 'icon-192.png'],
    [512, false, 'icon-512.png'],
    [512, true, 'icon-maskable-512.png']
];
for (const [size, maskable, nombre] of trabajos) {
    fs.writeFileSync(path.join(OUT, nombre), png(size, raster(size, size, maskable)));
    console.log(`✓ icons/${nombre} (${size}×${size}${maskable ? ', maskable' : ''})`);
}
