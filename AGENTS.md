# Instrucciones para agentes — Simulador OPE SESCAM

Este archivo da contexto de alta señal a futuras sesiones de OpenCode/IA para
evitar regresiones, saltos de seguridad y corrupción de estado.

## 🛠 Arquitectura estática, sin build
- **Entorno:** no hay bundlers, compiladores ni scripts de gestor de paquetes.
  Es una SPA 100% estática que corre en el navegador con módulos ES (ESM).
- **Servidor de desarrollo local:** usa cualquier servidor estático, por ejemplo:
  - `python -m http.server 8000`
  - Live Server (extensión de VS Code)
- **PWA:** `manifest.webmanifest` + `sw.js` (service worker, **red primero** para
  no servir nunca JS/HTML antiguos; solo cachea GET del mismo origen como
  respaldo offline). Los iconos están en `icons/`. Sube `CACHE` en `sw.js` si
  cambia el shell.

## 🔒 Seguridad, licencias y acceso a datos (ESTRICTO)
- **Bloqueo de licencia:** límite de 2 dispositivos **atómico y server-side**
  (RPC `registrar_dispositivo` sobre la tabla `dispositivos`, llamada desde
  `login`). Tablas: `usuarios_acceso`, `access_logs`, `dispositivos`.
- **RLS activo, sin políticas:** el navegador NO lee ni escribe esas tablas con
  la clave pública; todo pasa por las Edge Functions (`login`, `get-bank`,
  `admin-logs`) con la `service_role`. SQL: `supabase/sql/rls_and_devices.sql`.
- **Login:** usuario + contraseña se validan en la Edge Function `login` (PBKDF2,
  **en el servidor**), que devuelve un **token firmado** (HMAC). Ese token es el
  que exige `get-bank`: conocer solo el código de usuario ya no basta. Las
  contraseñas se dan de alta con `node scripts/set_password.js <usuario> <contraseña>`
  (columna `password_hash` en `usuarios_acceso`). El formato del hash es
  `pbkdf2$100000$saltB64$hashB64` (compartido en
  `supabase/functions/_shared/crypto.ts`).
- **Acceso a datos:** los bancos de preguntas NO viven en el repo. Se guardan en
  un bucket **privado** de Supabase Storage (`preguntas`) y los sirve la Edge
  Function `supabase/functions/get-bank`, que **valida el token** y vuelve a
  comprobar la licencia en el servidor con la `service_role`. El navegador solo
  habla con `login` y `get-bank`.
- **RESTRICCIÓN CRÍTICA:** no alterar, comentar, refactorizar ni saltarse la
  lógica de autenticación o de conexión con Supabase (principalmente en
  `src/js/modules/auth.js`, `src/js/main.js`, `db.js`) sin permiso explícito.
  `auth.js` ahora consume `login` y guarda el token (`Storage.getToken()`).
- **Restricción de render de UI:** la interfaz NO debe mostrar ninguna vista
  (ni ocultar las pantallas de acceso `#access-overlay`) hasta que la promesa de
  comprobación `Auth.checkAuth` devuelva `onSuccess`.
- **NUNCA poner la `service_role` (ni ninguna clave `sb_secret_`) en el
  frontend.** Vive solo en el entorno de la Edge Function y en el `.env` local
  de los scripts de subida/descarga. `config.js` solo lleva la publishable key.

## 📦 Particularidades de imports y carga de datos
- **PROHIBICIÓN ESTRICTA:** no añadir parámetros de versión ni sufijos de
  cache-busting (p. ej. `?v=1.2`) a los `import` de módulos ES. Provoca
  instancias duplicadas en el navegador y rompe el estado global (como
  `state.js` o `storage.js`). Los imports deben ir limpios:
  ```javascript
  import { state } from './state.js';
  ```
- **Los bancos se piden con `POST /functions/v1/get-bank`** con `{ bank, token }`
  (token de sesión emitido por `login`). El token viaja en el **cuerpo**, nunca en
  la URL. `data.js` es el único módulo autorizado a llamar a `get-bank`.
- Si añades un banco: pon el JSON en `data/`, regístralo en el array `BANKS` y
  ejecuta `node scripts/upload_banks.js` para subirlo al bucket privado.
  `verify_refs.js` falla si un JSON local no está registrado.
- Un banco que no carga **nunca** debe fallar en silencio: `fetchBank()` lo
  informa, `loadAllData()` conserva el resto, `showDataWarning()` muestra
  `#data-warning` y `getLastLoadReport()` expone la lista completa.
- No hay respaldo offline por diseño: si Supabase está caído o pausado, la app
  muestra el aviso de datos en vez de servir ficheros antiguos.

## 🗄️ Ingesta y estructura de datos
- **`data/` está en `.gitignore` a propósito.** Los bancos viven solo en el
  bucket privado; `data/` es una copia local para subir y ejecutar los tests.
  Un clon limpio no tiene `data/`: restáurala con
  `node scripts/download_banks.js`.
- **Solo sumativo:** cualquier categoría, examen o pregunta en `data/` o en
  `data.js` debe añadirse sin sobrescribir, renombrar ni borrar variables,
  arrays globales o diccionarios que mapean botones con exámenes.
- **Validación de formato:** verifica la sintaxis JSON al añadir grandes bloques
  de preguntas. Un banco malformado se descarta entero y se informa; nunca debe
  tumbar el cargador.
- **Scripts de preprocesado:** hay una suite de scripts Python y JS en
  `/scripts/` para limpieza, detección de duplicados y scraping. Ejecútalos
  directamente (p. ej. `node scripts/check.js`, `python scripts/check_dupes.py`).

## 🗺️ Navegación e historial
- **Integración con el historial:** la app usa una pila de historial propia
  junto con `window.onpopstate` y `UI.goBack()`.
- **Restricción:** usa el enrutado central `UI.showView(viewName)` en vez de
  modificar clases del DOM directamente (`classList.add/remove('hidden')`) para
  mantener el historial sincronizado y evitar bucles de navegación.

## 💾 LocalStorage y aislamiento por rol
- **Aislamiento por prefijo:** las claves de fallos y progreso deben usar el
  `currentPrefix` dinámico (id de licencia + rol activo, p. ej. pinche vs
  celador) para garantizar aislamiento por usuario y categoría.
- **Patrón de claves de fallos:** deben seguir el formato exacto
  `{prefix}_{tema}_{bloque}` para permitir el cálculo de progreso en cascada.
- `currentPrefix` es `u_{id}_` para pinche y `u_{id}_celador_` para celador.
  Solo `storage.js` construye estos prefijos, mediante `pk(key)`.
- **TODAS las claves de datos de usuario DEBEN pasar por `pk()`**: fallos,
  dudosas (`DUDOSAS`), intentos (`ATTEMPTS`), progreso, récords, respondidas
  (`ANSWERED`) y la sesión suspendida. Nunca escribas un
  `localStorage.setItem('simulador_sescam_records', ...)` o
  `'estado_test_suspendido'` a pelo: esos datos estarían compartidos entre
  usuarios del mismo navegador.
- **Claves por USUARIO (sin rol):** la racha (`ope_streak`), su fecha, el
  contador diario (`ope_daily`) y `last_role`, construidas con `userPrefix()`.
- **Sincronización (`sync-progress`):** el progreso se sube/fusiona por usuario.
  Reglas del merge: fallos y dudosas = **gana el último estado** (para poder
  borrar); historial = unión; récords/respondidas/racha = máximo; intentos = la
  lista más larga. **`last_role` y la sesión suspendida son LOCALES** y NO se
  sincronizan (si se hiciera, la categoría saltaría al recargar).
- La **Media** se calcula de los intentos (`addAttempt`/`getTestAverage`),
  independiente del récord (mejor nota). El color del sello de nota está en la
  clase base `.badge-record` (`.pass` verde / `.fail` rojo).
- Al añadir una clave nueva por usuario: agrégala a `KEYS`, inclúyela en `pk()`
  y migra cualquier clave legacy sin prefijo de forma perezosa dentro de su
  getter (adopta el valor antiguo en la clave con prefijo y borra la vieja).
- Cambiar de rol debe refrescar la UI asociada al rol: llama a
  `Storage.setRole(role)` y vuelve a renderizar récords/progreso/fallos.

## 🎨 Estructura del CSS (una hoja tokenizada)
- Todo vive en `css/style-v31.css`, organizado por capas: tokens → reset →
  layout → componentes → responsive → accesibilidad.
- Todos los colores, radios y sombras salen del bloque de tokens `:root`. NO
  escribas un hex que ya tiene token, ni dejes un token definido y sin usar:
  `verify_refs.js` falla en ambos casos (`var(--x)` usado sin definir, y tokens
  muertos).
- Nunca definas el mismo selector dos veces en el mismo contexto (las media
  queries cuentan como contexto). Los bloques duplicados se pisan en silencio;
  `verify_refs.js` falla si reaparecen.
- Tipografía: `Inter` se carga desde Google Fonts en `index.html`. Si cambias
  los pesos usados en CSS, actualiza también la URL de la fuente.
- Suelo de accesibilidad (mantener): estilos `:focus-visible` para teclado,
  `@media (prefers-reduced-motion: reduce)` para calmar animaciones y **nada de
  `user-select: none` global**.
- La hoja se cache-bustea como `css/style-v31.css?v=<versión>` en `index.html`;
  súbela junto con `CONFIG.APP_VERSION`.

## ♿ Convenciones de HTML y accesibilidad
- **Sin `style=""` inline en `index.html`**; toda regla de presentación vive en
  la hoja. `verify_refs.js` falla si reaparece uno.
- Toda clase usada en `index.html` debe existir en la hoja; una regla que falta
  es un bug. El layout reutilizable va en el bloque de utilidades
  (`.text-center`, `.m-0`, `.mt-40`…); los ajustes puntuales usan el `id`.
- Iconos/SVG decorativos con `aria-hidden="true" focusable="false"`. Botones
  solo-icono con `aria-label`.
- Overlays y modales con `role="dialog"`, `aria-modal="true"` y
  `aria-labelledby` apuntando a su título.
- Contadores dinámicos (nota, número de pregunta, cronómetro) con
  `aria-live="polite"`; el aviso de fallo de datos con `role="alert"`.

## 🧪 Scripts de verificación (ejecutar antes de commitear)
No hay build, así que la corrección se comprueba con estos scripts Node (desde
la raíz del repo):
- `node scripts/verify_refs.js` — comprobaciones estáticas: exports muertos,
  destinos de `getElementById` presentes en `index.html`, ids huérfanos, rutas
  rotas, imports resueltos, `?v=` prohibido en imports, validez JSON, unicidad
  global de ids, mojibake, consistencia de versión, que los `data/*.json`
  locales coincidan con `BANKS` y la salud del CSS (selectores duplicados,
  tokens sin definir o muertos, basura de escape literal, reduced-motion y
  focus-visible presentes, y clases CSS muertas).
- `node scripts/test_storage.js` — test funcional del aislamiento de
  localStorage entre usuarios y roles, y del export/import del progreso.
- `node scripts/test_fullview.js` — test funcional de la vista completa en sus 3
  modos (carga el `state.js` real, simula `ui.js`/`storage.js`).
- `node scripts/test_data_loader.js` — test funcional del cargador: simula
  `get-bank`, comprueba los 17 bancos, un banco caído, un banco truncado, 5
  tipos de pregunta inválida, que el dataset es idéntico byte a byte al SHA-256
  registrado y que la licencia nunca viaja en la URL.
- `node scripts/test_game_flow.js` — test funcional del flujo normal de test:
  reset de `startGame`, acierto/fallo, navegación next/prev, historial y récord
  al finalizar, y nota penalizada de examen.
- Los tres tests anteriores usan `vm.SourceTextModule`, una API experimental.
  Incluyen `scripts/vm-bootstrap.js`, que los relanza automáticamente con
  `--experimental-vm-modules`, así que ejecútalos tal cual.
- `node scripts/dataset_fingerprint.js` — imprime un SHA-256 canónico de todo el
  dataset. Úsalo antes/después de tocar `data/` para demostrar que el contenido
  no cambió.
- `node scripts/generate_icons.js` — regenera los iconos PNG del PWA en
  `icons/` (sin dependencias). Ejecútalo si cambia la marca.
- `node scripts/upload_banks.js [--check]` — sube `data/*.json` al bucket
  privado (necesita `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` en `.env`).
- `node scripts/deploy_backend.js` — hace todo el backend de una vez: sube los
  bancos y despliega las funciones `login` y `get-bank` (`--no-verify-jwt`).
  Necesita la CLI de Supabase (o `npx`) y `supabase login` / `SUPABASE_ACCESS_TOKEN`.
- `node scripts/set_password.js <usuario> <contraseña> [--name "Nombre"]` — da de
  alta/actualiza un usuario y su contraseña (hash PBKDF2) en `usuarios_acceso`.
  `--list` muestra los usuarios y si tienen contraseña.
- `node scripts/download_banks.js [--check]` — restaura `data/*.json` desde el
  bucket (clon limpio / copia de seguridad).
- Los scripts de reparación de datos aceptan `--check` para validar sin
  escribir nada: `node scripts/fix_duplicate_ids.js --check`,
  `node scripts/fix_csif_encoding.js --check`.
- Cualquier cambio en `data/*.json` debe dejar cada JSON parseable y cada valor
  `correcta` presente en las `opciones` de su pregunta.
- Los IDs de pregunta deben ser únicos dentro de su fichero. Los IDs numéricos
  se reinician por fichero; préfijalos (p. ej. `mad_t11_155`) para evitar
  colisiones entre temas.
- Fuente única de la versión: `CONFIG.APP_VERSION` en
  `src/js/modules/config.js`. `index.html` debe coincidir con ella.

## 📚 Documentación del repositorio
- `README.md` — visión general, características, arquitectura y puesta en marcha.
- `LICENCIAS.md` — cómo funciona el límite de dispositivos, riesgos, RPC
  transaccional (no aplicada), recuperación, inventario y rotación de claves, y
  el apunte sobre los bancos servidos por Supabase.
- `AUDITORIA.md` — estado de la auditoría y correcciones aplicadas.
