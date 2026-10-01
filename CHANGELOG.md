# Historial de cambios (Changelog)

Todas las versiones relevantes del **Simulador Oposiciones SESCAM**. Sigue el
formato de [Keep a Changelog](https://keepachangelog.com/es/1.0.0/) y versionado
semántico (`MAJOR.MINOR.PATCH`). La fuente única de la versión es
`CONFIG.APP_VERSION` en `src/js/modules/config.js`.

## [1.22.0] — 2026-10-01
### Añadido
- **RLS activo** en `usuarios_acceso`, `access_logs` y `dispositivos` (sin
  políticas): la clave pública ya no puede leer ni escribir las tablas con el
  navegador.
- **Límite de 2 dispositivos server-side y atómico**: RPC `registrar_dispositivo`
  (tabla `dispositivos`, `for update`) llamada desde `login`. Arregla la carrera
  que permitía colar un tercer dispositivo.
- Nueva Edge Function **`admin-logs`**: el panel de administración pide los datos
  al servidor y solo responde a un usuario con `es_admin = true`.
- SQL: `supabase/sql/rls_and_devices.sql`; columna `usuarios_acceso.es_admin`.
### Cambiado
- `auth.js` ya **no toca las tablas**: solo habla con `login`. El dispositivo se
  registra en el servidor.
- Eliminada la dependencia del CDN `supabase-js` en `index.html` (ya no se usa).

## [1.21.2] — 2026-10-01
### Añadido
- **Ojo para ver/ocultar la contraseña** en el formulario de acceso.
- **Casilla “Recordar usuario”**: si está marcada, recuerda el nombre de usuario
  (nunca la contraseña) y mantiene la sesión persistente; si se desmarca, la
  sesión dura solo la pestaña y no se guarda el usuario.

## [1.21.1] — 2026-10-01
### Corregido
- **Service worker**: pasaba por la caché HTTP del navegador y podía servir el
  frontend antiguo tras un despliegue (causaba `401` al pedir los bancos). Ahora
  usa `cache: 'no-store'` (red siempre fresca) y `CACHE` sube a `v2`.

## [1.21.0] — 2026-10-01
### Añadido
- **Login con usuario + contraseña** validados en el servidor:
  - Nueva Edge Function `login` (PBKDF2 + token firmado con HMAC).
  - Nueva columna `usuarios_acceso.password_hash` (`supabase/sql/password_hash.sql`).
  - Script `scripts/set_password.js` para dar de alta usuarios y contraseñas.
  - Formulario de acceso con **Usuario** y **Contraseña**.
- **`get-bank` ahora exige el token** de sesión: conocer solo el código de
  usuario ya no permite descargar los bancos.
### Cambiado
- `auth.js` consume `login` y guarda el token (`Storage.getToken()`); `data.js`
  envía el token en vez del código.
- `scripts/deploy_backend.js` despliega `login` y `get-bank`.

## [1.20.2] — 2026-10-01
### Añadido
- **Formulario de login por código en la propia app**: campo “Código de acceso” +
  botón **Entrar**, sin necesidad de abrir la URL con `?user=`. Se mantiene el
  soporte de `?user=` en la URL.
- Se muestra **“✓ Conectado como \<código\>”** y un enlace **“Cambiar de usuario”**
  que olvida el usuario guardado y vuelve al login.
### Cambiado
- Cuando no hay código, el overlay muestra un **login neutro** (“Inicia sesión”)
  en vez de “Acceso Denegado”.

## [1.20.1] — 2026-10-01
### Cambiado
- **Jerarquía visual estricta en los botones de resultados**:
  1. **Principal** — “Repetir Test”: ancho completo, azul mate sólido (`#2563eb`).
  2. **Secundario** — “Volver a Selección”: estilo *outline* (sin fondo; borde y
     texto azules).
  3. **Terciario** — “Volver al Menú”: enlace de texto gris claro, sin aspecto de
     botón, debajo de los otros.
- Revisión (“Ver Todo”, “Solo Fallos”, “Borrar Fallos”) pasa a botones *outline*
  en una fila secundaria.
- Eliminados los **resplandores (glow)** de los botones principales y los
  degradados; ahora son de color **mate**.

## [1.20.0] — 2026-10-01
### Cambiado
- **Nuevo tema oscuro con acentos turquesa**: fondo de app `#1a1e2e`,
  contenedores `#242a3a` con esquinas de **16px** y sombra suave, texto claro
  (blanco/gris) y acento **turquesa `#38bdf8`** en títulos, etiquetas y flechas.
- **Selects del simulacro** con fondo blanco puro (`#FFFFFF`) y flecha turquesa.
- Fondos de estado (feedback de respuesta, opción correcta, etiquetas `tag`,
  chips, barras) en tonos **translúcidos** para mantener el contraste sobre oscuro.
- Se elimina la tarjeta gris claro del tema anterior (queda sustituida por el
  contenedor oscuro).

## [1.19.3] — 2026-10-01
### Cambiado
- Las tarjetas pasan de blanco puro a **gris muy claro (`#F1F5F9`)** para no
  verse tan planas, manteniendo el texto oscuro y el fondo oscuro. Es un único
  token (`--card-bg`), fácil de revertir a blanco.

## [1.19.2] — 2026-10-01
### Corregido
- **Texto invisible dentro de las tarjetas blancas**: al poner el color del
  `body` en claro, las tarjetas no reseteaban el color, así que el texto sin
  color explícito (como las líneas del desglose) heredaba el claro y no se veía.
  Ahora `.card` y las tarjetas de la vista completa fijan `color: #111827`.
- **Icono “Blancas”**: el emoji ⚪ (círculo blanco) era invisible sobre blanco;
  se usa `○`, que toma el color del texto.
- **No se podía finalizar en la última pregunta** si estaba sin responder (el
  botón “Siguiente” estaba oculto): ahora el botón **Finalizar** aparece siempre
  en la última pregunta, en todos los modos. Cubierto con test de regresión.

## [1.19.1] — 2026-10-01
### Cambiado
- **Desglose de puntuación del examen con cada línea coloreada y legible**:
  - `Aciertos: N` en verde oscuro (`#15803d`).
  - `Errores: N (-0.33 c/u)` en rojo oscuro (`#b91c1c`).
  - `Blancas: N` en gris oscuro.
  - `Puntuación neta` en gris nítido y seminegrita.
  - `Nota Final (0–10)` en teal oscuro (token `--primary-dark`).
  - Fórmula final en gris oscuro.
- La nota del examen (`0.00 / N pts`) usa teal de alto contraste en ambas partes.

## [1.19.0] — 2026-10-01
### Cambiado
- **Nueva paleta de alto contraste**: fondo general oscuro (slate) con
  **tarjetas blancas sólidas (`#FFFFFF`)** y texto oscuro (`#111827`) dentro de
  ellas. Sustituye el cristal translúcido anterior.
- Colores de estado **vivos** (verde `#16a34a`, rojo `#dc2626`, ámbar `#b45309`)
  para que aciertos y errores resalten sobre el blanco.
- Se elimina el bloque de modo oscuro automático: el tema base ya es oscuro con
  tarjetas blancas.
- La configuración del test aleatorio se envuelve en una tarjeta blanca.

## [1.18.3] — 2026-10-01
### Corregido
- **Contraste y legibilidad de colores**:
  - Los textos del feedback de resultados (verde/teal/ámbar/rojo) se oscurecen en
    modo claro para leerse bien sobre el fondo.
  - El feedback de respuesta (correcto/incorrecto) pasa a clases CSS: ya no se
    vuelve ilegible en modo oscuro (texto claro sobre fondo claro).
  - Los textos en teal (Entrenamiento, títulos de sección, cabeceras de tabla…)
    se oscurecen en claro y se aclaran en oscuro.
  - El desglose de puntuación del examen deja de usar estilos inline y se adapta
    al modo oscuro.

## [1.18.2] — 2026-10-01
### Añadido
- Exportar/importar el progreso como JSON desde "Mi Progreso". El import solo
  acepta claves del prefijo del usuario actual (cubierto por test).
- Service worker (`sw.js`) en modo **red primero**: nunca sirve JS/HTML
  antiguos y da respaldo offline del shell. Ignora Supabase/CDN.

## [1.18.1] — 2026-10-01
### Añadido
- **Modo oscuro** automático según `prefers-color-scheme` (tokens y superficies
  de cristal ajustadas).
- **Desglose de aciertos por tema** en la pantalla de resultados.
- **Bienvenida** la primera vez, con resumen de modos y atajos.

## [1.18.0] — 2026-10-01
### Añadido
- **Estadísticas por tema** y **lista de preguntas falladas** en "Mi Progreso".
- **Simulacro configurable**: elegir nº de preguntas (10–40 o todas) y tiempo
  (30 s / 1 min / 2 min / sin límite). Sustituye al antiguo interruptor de cronómetro.
### Corregido
- Varios artefactos de formato (`>` suelto) que dejó la eliminación de estilos inline.

## [1.17.9] — 2026-10-01
### Añadido
- Leyenda de atajos bajo el test (oculta en dispositivos táctiles).
- Al navegar (siguiente/anterior/rejilla), el foco va al enunciado.
- La rejilla marca la pregunta actual con `aria-current`.
- Aviso (toast) "Progreso guardado" al salir de un test.

## [1.17.8] — 2026-10-01
### Añadido
- Test `test_game_flow.js`: flujo normal de test (reset, acierto/fallo,
  next/prev, historial y récord, nota penalizada de examen).
- Barra de progreso con `role="progressbar"` y `aria-valuenow`/`valuetext`.
- Feedback de respuesta con `role="status"`/`aria-live`.

## [1.17.7] — 2026-10-01
### Añadido
- Spinner en el overlay de acceso; se mantiene hasta que cargan los bancos.
- Reintento automático (1 vez) de `get-bank` ante fallo transitorio (red/5xx).
- Anti-doble-clic al iniciar test.
- Atajos de teclado: `1`–`4` responder, `←`/`→` navegar.
- Recordar la última categoría por usuario.
- **PWA**: manifest, iconos PNG (normal + maskable) y metas de instalación.
- Script `deploy_backend.js` (sube bancos y despliega `get-bank` en un paso).

## [1.17.6] — 2026-10-01
### Cambiado
- Título general: "Simulador Oposiciones SESCAM" (ya no solo Pinche).
- Favicon SVG propio y `preconnect` a Supabase/CDN.
- Diálogos accesibles: atrapan el foco, lo devuelven al cerrar y se cierran con Escape.
### Eliminado
- El bloque "anti-copia" (`contextmenu` + Ctrl+C/X/P/A/S): era inefectivo y
  contradecía el poder seleccionar texto.

## [1.17.5] — 2026-10-01
### Corregido
- Clases de estado que el JS usaba pero no existían en el CSS
  (`texto-exito-teal`, `texto-bien-teal`, `texto-aviso-naranja`,
  `texto-peligro-rojo`, `selected`): el feedback de resultados no se coloreaba.
- Eliminadas clases CSS muertas (`.badge-record.teal`, `.topics-grid`, `.error-text`).

## [1.17.4] — 2026-10-01
### Cambiado
- El contenedor principal pasa a `<main>` (landmark accesible).
- `aria-label` en la tabla de administración y `color-scheme: light`.

## [1.17.3] — 2026-10-01
### Cambiado
- **Cero estilos inline** en `index.html`: todo a clases de la hoja.

## [1.17.2] — 2026-10-01
### Añadido
- Semántica de diálogos (`role="dialog"`, `aria-modal`, `aria-labelledby`),
  12 botones solo-icono con `aria-label`, SVG decorativos con `aria-hidden`,
  `aria-live` en contadores.
- Definidas 7 clases que el HTML usaba sin estilo.
### Cambiado
- `meta description` y `theme-color`; `<body>` sin estilos inline.

## [1.17.1] — 2026-10-01
### Corregido
- `.login-box` usaba `var(--shadow)` sin definir (la sombra no se dibujaba).
- Selectores duplicados que se pisaban en silencio; secuencia literal `\n`;
  13 líneas con mojibake.
### Cambiado
- Hoja **tokenizada** (color, radios, sombras); `Inter` se carga de verdad;
  menos `!important`; una sola media query de 768 px.
### Añadido
- `:focus-visible`, `prefers-reduced-motion`; se retira `user-select: none`.

## [1.17.0] — 2026-10-01
### Cambiado
- **Los bancos de preguntas salen del repo público.** Se sirven desde un bucket
  **privado** de Supabase Storage mediante la Edge Function `get-bank`, que
  valida la licencia en el servidor. `data/` pasa a `.gitignore`.
- `data.js` pide los bancos con `POST /functions/v1/get-bank`.
### Añadido
- Scripts `upload_banks.js` y `download_banks.js`.

## [1.16.x] — anterior
### Corregido
- Re numeración de 677 IDs duplicados de MAD y reparación de codificación UTF-8 de CSIF.
- Aislamiento de fallos y sesión por usuario + rol (`pk()`), con migración legacy v2.
- Navegación, persistencia de sesión cada 5 s y vista completa.
### Añadido
- Cargador JSON robusto con validación, avisos visibles (`#data-warning`) e informe.
- Suite de verificación: `verify_refs`, `test_storage`, `test_fullview`,
  `test_data_loader`, `dataset_fingerprint`.
### Eliminado
- Código muerto: `js/script.js`, `css/style-v30.css`, CryptoJS y overlay de login antiguo.
