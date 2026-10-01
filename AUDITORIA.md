# 📋 Auditoría Técnica y Documentación — Simulador OPE SESCAM

**Fecha de la revisión:** 30/09/2026
**Alcance:** Revisión completa de código (front-end), estructura de datos, y sistema de licencias anti-compartición (Supabase).
**Estado del código:** Funcional y estable. La app arranca, carga 5.245 preguntas y todos los flujos principales operan correctamente. Se han detectado **3 riesgos de seguridad críticos a verificar**, **2 bugs de datos que afectan al usuario**, y una serie de mejoras de mantenibilidad y rendimiento.

---

## 0. Estado de las correcciones (v1.16.5)

Aplicadas y verificadas en local:

| # | Ítem | Estado |
|---|------|--------|
| D1 | `t1_26` (Seguridad Jurídica) respondía `a,b`; la correcta es `c` | ✅ Corregido |
| D2 | 180 IDs duplicados / 433 preguntas afectadas (Temas 11–16) | ✅ Renumerados a `mad_t{N}_{id}`; 3.906 IDs únicos |
| D3 | `csif_questions.json` grabado en CP850 (mojibake) | ✅ Reescrito en UTF-8; parche de runtime eliminado de `data.js` |
| C1 | Sesión suspendida y récords sin prefijo de usuario (se compartían en el mismo navegador) | ✅ Ahora pasan por `pk()` con migración perezosa |
| C2 | Vista continua: no puntuaba, no bloqueaba y puntúa a cada clic | ✅ Corregido y probado en los 3 modos |
| C3 | `Solo Fallos` aparecía sin fallos reales | ✅ Solo con `fallos > 0` |
| C4 | Vistas completas quedaban "colgadas" al agotarse el tiempo | ✅ `resetFullView()` en `startGame()` |
| C5 | Sesión serializada en cada tick del cronómetro | ✅ Ahora cada 5 s |
| C6 | CryptoJS (CDN), `login-overlay` y `VALID_HASH` muertos | ✅ Eliminados; versión unificada en `CONFIG.APP_VERSION` |
| C7 | Sin forma de reintentar tras un Acceso Denegado | ✅ Input de código en el overlay (sin tocar `auth.js`) |
| C8 | Comparación del admin sensible a mayúsculas | ✅ `CONFIG.ADMIN_USER`, case-insensitive |
| C9 | Un id renombrado rompía en cascada todos los listeners | ✅ Helper `on(id, event, fn)` |
| C10 | Lógica de rol duplicada; sesión no se refrescaba al cambiar de rol | ✅ `selectRole()` |
| S2 | Credenciales del Supabase anterior en `js/script.js` | ✅ Archivo borrado (rotar la clave vieja en Supabase) |
| — | Archivos muertos: `css/style-v30.css`, `deploy_test.txt`, `#final-message`, `.hidden` duplicado | ✅ Eliminados |

**Pendiente (requiere acceso a Supabase, deliberadamente NO tocado):**
- S1 — Verificar/activar RLS. El bloque SQL de la sección S1 está **corregido**: `using (true)` en `usuarios_acceso` se marcó como inseguro porque devolvería todas las filas.
- S3 — RPC atómica `validar_acceso` (elimina la condición de carrera del contador) + RPC para el panel de admin.
- Data pública: los JSON siguen siendo accesibles por URL (protección de contenido, no de licensing).

---

## 1. Arquitectura actual (documentación)

### 1.1. Stack
- **Front-end 100% estático** (SPA) sin build: HTML + CSS + JavaScript ES6 Modules. Se despliega en GitHub Pages desde la raíz del repo (`SenorJA/simulador-oposicion`).
- **Back-end:** Supabase (PostgreSQL) usado **exclusivamente** para el control de licencias (máx. 2 dispositivos por código). No hay API propia ni auth de usuarios real.

### 1.2. Estructura de archivos

```
index.html                  → Vista única (10 vistas gestionadas por JS) + overlays de acceso
css/style-v31.css           → Hoja de estilos activa (30 KB, glassmorphism, responsive)
src/js/main.js              → Punto de entrada: auth → carga datos → listeners de eventos
src/js/modules/
  ├─ config.js              → CONFIG (Supabase, versión) + TOPIC_TITLES
  ├─ state.js               → Estado global en memoria (singleton) + resetGameState()
  ├─ auth.js                → Validación de licencia contra Supabase + límite 2 dispositivos
  ├─ storage.js             → localStorage: fallos, historial, récords, sesión suspendida
  ├─ data.js                → Carga y normaliza los 17 JSON de preguntas
  ├─ topics.js              → Navegación fuente → parte → tema/bloque/parte
  ├─ ui.js                  → showView()/goBack() (pila de historial), badges y barras de progreso
  └─ game.js                → Motor del test: preguntas, corrección, cronómetro, resultados
data/*.json                 → 17 bancos de preguntas (2,6 MB en total)
scripts/                    → Scripts de ingesta/limpieza (Node + Python), no forman parte de la app
js/script.js                → ⚠️ LEGACY de 59 KB, ya no se usa (ver hallazgo S2)
css/style-v30.css           → ⚠️ Versión antigua sin referenciar
```

### 1.3. Flujo de arranque
1. `main.js` bloquea el menú contextual y atajos de copiado.
2. `Auth.checkAuth()` lee `?user=CODIGO` de la URL (o el usuario guardado en localStorage) y valida contra Supabase.
3. **La UI no se muestra hasta que `onSuccess` se ejecuta** (correcto, conforme a las reglas del proyecto).
4. `Data.loadAllData()` descarga los 17 JSON en paralelo con cache-busting `?v=Date.now()`.
5. Se renderizan badges de fallos, récords y progreso; se muestra `view-role-selection`.

### 1.4. Modelo de datos de una pregunta
```json
{ "id": "ex2020_1", "tema": "Tema 1", "pregunta": "...", "opciones": {"a":"..","b":"..","c":"..","d":".."}, "correcta": "a", "origen": "MAD", "source": "MAD" }
```
- Fuente **Academia** usa formato distinto (`opciones` array + `respuesta_correcta` texto) y se normaliza en tiempo de carga (`normalizeAcademiaQuestion`). ✅ Correcto, 665/665 preguntas Academia tienen su respuesta localizada.
- Las preguntas **CSIF** sufren mojibake (codificación CP850 leída como Latin-1) y se reparan en tiempo de ejecución con `fixEncoding()` (ver hallazgo D3).

### 1.5. Inventario de preguntas (verificado, todo parsea OK)

| Fuente | Archivo(s) | Preguntas |
|---|---|---|
| MAD + Histórico + CSIF embebido | `preguntas.json` | 3.906 (1,8 MB) |
| CSIF | `csif_questions.json` | 132 |
| Academia | `academia_tema{1,2,3,4,5,8,9,10}.json` | 665 |
| Celador 2024 | `sescam_2024_celador.json` | 100 |
| Pinche Ord. 2026 | `sescam_2026_pinche_ord.json` | 65 |
| Pinche Extra. 2026 | `sescam_2026_pinche_extra.json` | 65 |
| Celador 2026 | `sescam_2026_celador.json` | 65 |
| Celador Extra. 2026 | `sescam_2026_celador_extra.json` | 65 |
| Cocinero 2026 | `sescam_2026_cocinero.json` | 82 |
| Técnico TI 2026 | `sescam_2026_tecnico_ti.json` | 100 |
| **TOTAL** | | **5.245** |

✅ Los 17 JSON tienen sintaxis válida. ✅ Todas las preguntas tienen `id`, ≥2 opciones y `correcta` en minúscula (salvo 1 excepción, ver D2).

---

## 2. 🔒 Seguridad del sistema anti-compartición (lo más importante)

Tu preocupación principal es que nadie comparta su licencia con amigos. El diseño actual (límite de 2 dispositivos verificado en el cliente) es **una barrera razonable para usuarios normales, pero tiene 3 puntos que debes verificar/blindar en Supabase**, porque toda la lógica vive en el navegador y la clave `sb_publishable_...` es pública por diseño.

### S1 — ⚠️ CRÍTICO (verificar ya): Row Level Security (RLS) en Supabase
No pude comprobarlo desde este entorno (sin salida de red), así que **debes verificarlo tú en 2 minutos**:

Abre en el navegador (sin loguearte en ningún sitio):
```
https://ictintjdebutsjkbexpc.supabase.co/rest/v1/usuarios_acceso?select=id_acceso,dispositivos_usados&apikey=sb_publishable_ZBq95C7iXJxI4wkltK5YCA_45_zGPEW
```
- **Si devuelve la lista de códigos de usuario → agujero crítico:** cualquiera puede robar todos los códigos válidos y repartirlos.
- **Si devuelve `[]` o un error de permisos → RLS está activo (bien).**

**Cómo blindarlo (SQL en el editor de Supabase):**

> ⛔ **NO APLIQUES ESTE SQL TAL CUAL.** Se conserva como registro de lo detectado;
> la versión corregida va justo debajo.

```sql
-- 1. Activar RLS en ambas tablas
alter table usuarios_acceso enable row level security;
alter table access_logs   enable row level security;

-- 2. usuarios_acceso: SIN política de SELECT para anon.
--    El login por código NO puede hacerse con una política RLS, porque RLS no
--    puede filtrar por un parámetro que viene del cliente: `using (true)`
--    devolvería TODAS las filas y cualquiera podría enumerar los códigos.
--    La única opción segura es la función RPC de la sección S3.

-- 3. PROHIBIR que el cliente modifique el contador directamente.
--    (Sin política de UPDATE/DELETE para anon = nadie puede resetearlo.)
revoke update, delete on usuarios_acceso from anon;

-- 4. access_logs: solo se permite INSERTAR (escribir logs), nunca leer
create policy "insertar_logs" on access_logs
  for insert with check (true);
revoke select, update, delete on access_logs from anon;
```

> ⚠️ **Consecuencia:** con RLS activo y sin RPC, el login deja de funcionar.
> El orden correcto es: (a) crear la RPC atómica de la sección S3, (b) cambiar
> `auth.js` para usarla, (c) solo entonces activar RLS. El panel de admin
> ("Ver Conexiones") también necesita una RPC propia, porque revocar el SELECT
> de `access_logs` lo deja sin datos.

**¿Por qué es vital?** Hoy, si no hay RLS, un usuario con conocimientos medios puede abrir la consola del navegador y ejecutar `update dispositivos_usados = 0` sobre su fila (o la de un amigo) para resetear el límite de 2 dispositivos infinitamente. Con `revoke update`, eso se vuelve imposible.

### S2 — ⚠️ ALTO: credenciales antiguas expuestas en `js/script.js`
El archivo legacy `js/script.js` (ya no se carga) contiene las credenciales del **proyecto Supabase anterior** (`eykwcwgplldapzjnxuym.supabase.co`). Como GitHub Pages sirve todo el repo, ese archivo es público.
**Acción:** borrar `js/script.js`, `css/style-v30.css`, `deploy_test.txt` y mover `manual_input.txt` y los `scripts/raw_*.txt` fuera de la raíz pública (o a `_archived_files/`, que está en `.gitignore`). Si el proyecto Supabase antiguo sigue existiendo, dalo de baja o rota su clave.

### S3 — RECOMENDADO: mover el contador de dispositivos a una función RPC
Ahora mismo el cliente hace *leer contador → decidir → escribir contador+1*. Esto tiene una **condición de carrera**: si dos dispositivos entran a la vez con el mismo código, ambos leen "1" y ambos se registran (3 dispositivos con límite 2). Además obliga a dar permiso de UPDATE a la tabla.

Solución robusta (función en Postgres, el cliente solo la invoca):
```sql
create or replace function registrar_dispositivo(p_id_acceso text, p_device_short text)
returns json language plpgsql security definer as $$
declare
  v_count int; v_bloq boolean;
begin
  select dispositivos_usados, bloqueado into v_count, v_bloq
  from usuarios_acceso where id_acceso ilike p_id_acceso for update;  -- bloqueo de fila: sin carreras

  if not found then return json_build_object('ok', false, 'motivo', 'no_existe'); end if;
  if v_bloq then return json_build_object('ok', false, 'motivo', 'bloqueado'); end if;
  -- aquí iría la lógica de "dispositivo ya conocido" con una tabla de dispositivos registrados
  if v_count >= 2 then
    return json_build_object('ok', false, 'motivo', 'limite');
  end if;
  update usuarios_acceso set dispositivos_usados = v_count + 1 where id_acceso ilike p_id_acceso;
  return json_build_object('ok', true);
end $$;
```
Con esto podrías quitar el UPDATE al rol `anon` por completo. **Es la única forma de que el límite de 2 dispositivos sea realmente inbypasseable.** (No toco `auth.js` por las reglas del proyecto; esto queda como mejora propuesta para cuando decidas.)

### S4 — Limitación estructural (conviene conocerla): las preguntas son públicas
Al ser una web estática, `data/*.json` se descarga cualquiera que tenga la URL, sin licencia. El candado protege **la app**, no **el contenido**. Para un producto de pago entre opositores conocidos esto suele ser aceptable, pero si quieres cerrarlo del todo:
- Opción A (media): ofuscar/cifrar los JSON y descifrarlos en cliente tras el login (sigue siendo vulnerable a un usuario técnico, pero elimina el "copiar enlace a un amigo").
- Opción B (total): servir las preguntas desde Supabase con RLS (solo lectura tras validar licencia vía RPC).

### S5 — Menores
- El "panel admin" se protege solo comparando `id_acceso === 'PichonJefe'` en cliente. Cualquiera puede leer ese valor en el código. Con RLS bien puesto (S1) el panel no revela nada que un usuario no pueda ya consultar; aun así, la comprobación de `loadAdminLogs()` usa el código **tal como se tecleó** (case-sensitive): si entras como `pichonjefe` el login funciona (`ilike`) pero el panel admin se deniega. Usa `data.id_acceso` de la respuesta para comparar.
- El bloqueo de copiar/pegar (`contextmenu`, `Ctrl+C`, `user-select:none`) lo salta cualquiera con DevTools y molesta al usuario legítimo (no puede subrayar ni buscar un término). Valóralo: como disuasión está bien, pero no es seguridad real.

---

## 3. 🐞 Bugs de datos (afectan directamente al usuario)

### D1 — IDs duplicados en `preguntas.json` (prioridad alta)
- **180 IDs están duplicados (433 preguntas afectadas)**, todos en los **Temas 11–16** (los que usan IDs numéricos simples `1, 2, 3…` que colisionan entre temas).
- **Impacto real:** los fallos y el "auto-perdón" se guardan por `q.id`. Si fallas la pregunta `12` del Tema 13, también aparecen como falladas la `12` del Tema 14, 15 y 16, y el test de "Repasar Fallos" meterá preguntas que nunca has visto.
- **Solución:** renumerar con prefijo por tema (ej. `mad_t12_001`). Hay que hacerlo con un script en `scripts/` (sumativo, sin tocar el resto) y después vaciar una vez los fallos guardados con una nueva migración de versión (igual que hicisteis con `v1_unique_ids`).

### D2 — Pregunta incontestable: `t1_26` tiene `"correcta": "a,b"`
- En `preguntas.json`, la pregunta `t1_26` (Tema 1, Constitución, Bloque 1 MAD) tiene como correcta el texto `"a,b"`. Ninguna opción será nunca válida → **todo el mundo la falla siempre**.
- **Solución:** corregir a `"a"` (o la letra que proceda) en el JSON.

### D3 — Mojibake CSIF reparado en runtime (frágil)
- `csif_questions.json` está corrupto en disco (¾=ó, ±=ñ, ┐=¿…) y `data.js` lo repara al vuelo. Funciona (verificado: todas las "Ú" son "é" corruptas, no texto legítimo), pero:
  - Hay **reemplazos muertos/contradictorios** (`Ú→é` y luego `Ú→Ú`; `Ý→í` y luego `Ý→ï`): síntoma de que el mapa se construyó por ensayo y error.
  - Cualquier JSON futuro bien codificado que pase por `fixEncoding()` saldría corrupto.
- **Solución:** ejecutar una vez un script que re-escriba `csif_questions.json` en UTF-8 correcto y eliminar `fixEncoding()` del runtime.

### D4 — Inconsistencias de metadatos en exámenes
- El menú de exámenes filtra unas veces por `q.origen` y otras por `q.tema` (`main.js`), y en `data.js` el `origen` se re-etiqueta con valores distintos a los del JSON. Funciona hoy por coincidencia de textos, pero es frágil: un renombrado en un JSON rompe un botón silenciosamente ("Examen no cargado").
- `sescam_2026_cocinero.json` usa tema genérico `"Exámenes Años Anteriores"` y ya trae un campo `source` propio (el único archivo que lo hace).
- **Solución:** un único criterio: que cada examen lleve en el JSON un `origen` definitivo y que los botones filtren siempre por `origen`.

---

## 4. 🐞 Bugs de código (no rompen la app, pero conviene corregirlos)

| # | Archivo | Problema | Impacto |
|---|---|---|---|
| C1 | `storage.js` | La **sesión suspendida** (`estado_test_suspendido`) y los **récords** (`simulador_sescam_records`) **no llevan prefijo de usuario**; y la sesión tampoco se separa por rol | Dos licencias en el mismo navegador (o Pinche↔Celador) comparten test en pausa y récords. Rompe la regla de aislamiento del proyecto |
| C2 | `game.js` | `saveCurrentSession()` se ejecuta **cada segundo** (dentro del tick del cronómetro) serializando todas las preguntas a JSON | Consumo innecesario de CPU/batería en móvil; mejor guardar cada 5–10 s y en `visibilitychange`/`beforeunload` |
| C3 | `game.js` | Si el **tiempo se agota estando en "vista completa"**, `_fullViewActive` queda a `true` y la tarjeta de pregunta queda oculta; el siguiente test arranca con la vista rota | Bug visual real (caso borde). Resetear el flag en `startGame()` |
| C4 | `game.js` | En **vista completa** (modo entrenamiento) no se incrementa `state.score`, no hay "auto-perdón" de fallos (`removeFailedId`) y no se restaura el estado bloqueado/coloreado de preguntas ya respondidas | Contador "Aciertos" desincronizado y comportamiento distinto entre vista simple y completa (la nota final sí es correcta porque se recalcula) |
| C5 | `game.js`/`index.html` | El botón **"Solo Fallos"** se muestra cuando hay blancas aunque no haya fallos, pero `startReviewMode(true)` excluye blancas → salta la alerta "no tienes fallos" | Inconsistencia UX menor |
| C6 | `index.html` + `config.js` | `login-overlay`, `VALID_HASH` y la librería **CryptoJS (CDN) ya no se usan** para nada (la auth es por `?user=`) | Cargar CryptoJS es peso y riesgo de supply-chain gratis; quítalo. Tras un "Acceso Denegado" el usuario se queda sin poder reintentar: el overlay no tiene input de código |
| C7 | `main.js` | `setupEventListeners()` hace `getElementById(...).addEventListener` **sin comprobar null** en la mayoría de botones | Un id renombrado en el HTML rompe en cascada todo el setup (y de forma silenciosa el resto de listeners no se registran) |
| C8 | `main.js` | Lógica duplicada en los botones de rol Pinche/Celador (2 bloques casi idénticos) | Extraer a `selectRole(role)` |
| C9 | `css/style-v31.css` | La clase `.hidden` está definida **dos veces** (líneas 80 y 627) | Inofensivo, pero limpiable |
| C10 | varios | **Código muerto:** `logAccess()` (auth.js), `countTotalAtomicTests()` e `inferSourcePrefixFromQuestions()` (ui.js), wrapper `slugify()` (main.js), `get/setDeviceRegisteredFor` (storage.js) | Ruido de mantenimiento |
| C11 | versionado | El título dice `v1.15.7`, el script se carga con `?v=1.16.4-premium`, `APP_VERSION` dice `v1.15.7 (Force)` y el README dice `v1.16.x` | Unificar en un solo lugar (idealmente solo `CONFIG.APP_VERSION` y generar el resto) |

---

## 5. ⚡ Rendimiento

1. **2,6 MB de JSON se descargan en CADA visita** porque el cache-busting es `?v=${Date.now()}`. En móvil con datos se nota.
   - Mejora compatible con las reglas del proyecto: usar `?v=${CONFIG.APP_VERSION}` (busting por release, no por carga). Sigue habiendo cache-busting, pero el navegador reutiliza la caché entre visitas de la misma versión.
2. `preguntas.json` (1,8 MB) mezcla MAD + CSIF-embebido + Histórico + exámenes 2020 + CCAA. A medio plazo conviene trocearlo por fuente para poder cargar bajo demanda (lazy load) solo lo que el usuario abre.
3. `renderizarProgresoGlobal()` recorre y recalcula todos los récords en cada cambio de vista; con el volumen actual es imperceptible, pero si el temario crece, conviene cachear los agregados.

---

## 6. ✅ Lo que está bien (no tocar)

- Arquitectura modular ESM limpia y sin build; imports sin cache-busting (cumple la regla de oro).
- La UI **no se renderiza hasta el OK de auth** (cumple la regla de seguridad).
- Lógica de **auto-recuperación (self-healing)** del contador de dispositivos consultando `access_logs`: buena idea, bien acotada.
- Aislamiento de fallos/historial por prefijo `u_{usuario}_{rol}_`: correcto en `FAILED_IDS` y `PROGRESS`.
- Migración de datos versionada (`v1_unique_ids`) para no romper a usuarios antiguos.
- Saneado de BOM antes de `JSON.parse`, carga en paralelo con `Promise.all`, y degradación elegante (`'[]'`) si un JSON opcional falta.
- Los 17 JSON de datos son sintácticamente válidos (verificado uno a uno).
- Suite de scripts de ingesta/verificación en `/scripts` (aunque algunos usan rutas absolutas; mejor parametrizar).

---

## 7. 🗂 Plan de acción recomendado (por prioridad)

**P0 — Seguridad (hacer esta semana):**
1. Verificar RLS en Supabase con la URL de prueba de la sección S1 y aplicar el SQL de blindaje.
2. Borrar `js/script.js` (credenciales antiguas) y limpiar la raíz (`deploy_test.txt`, `manual_input.txt`, `css/style-v30.css`).
3. Corregir `t1_26` (`"correcta": "a,b"`).

**P1 — Calidad de datos:**
4. Script para renumerar IDs duplicados de Temas 11–16 + migración de versión que reinicie fallos.
5. Re-codificar `csif_questions.json` a UTF-8 y eliminar `fixEncoding()` del runtime.
6. Unificar filtrado de exámenes por `origen`.

**P2 — Robustez y UX:**
7. Prefijar sesión suspendida y récords por usuario+rol (C1).
8. Resetear `_fullViewActive` en `startGame` (C3) y alinear vista completa con la lógica de score/perdón (C4).
9. Quitar CryptoJS y el login-overlay muerto; añadir input de código en el overlay de acceso denegado (sin tocar la lógica de `auth.js`).
10. Cache-busting por versión de release en lugar de `Date.now()`.
11. Null-checks en `setupEventListeners` y extraer `selectRole()`.
12. Unificar versión visible de la app.

**P3 — Blindaje definitivo de licencias (cuando quieras):**
13. RPC `registrar_dispositivo` con `security definer` + `revoke update` al rol anon (S3). Con esto, ni un usuario técnico puede resetear su contador.

---

## 8. Cómo verificar que todo sigue funcionando tras los cambios
1. Servir en local: `python -m http.server 8000` → `http://localhost:8000/?user=TU_CODIGO`.
2. Probar: login OK / login denegado / tercer dispositivo bloqueado.
3. Test rápido de humo: un test por fuente (MAD, CSIF, Academia), un examen 2026, repaso de fallos, aleatorio, pausar y reanudar, y modo examen con cronómetro hasta el final.
4. `node scripts/check_dupes.py` (o similar) tras cualquier ingesta nueva de preguntas.

---

*Documento generado en la auditoría del 30/09/2026. Respetadas las reglas del proyecto: no se ha modificado la lógica de autenticación ni se han añadido sufijos de versión a los imports.*
