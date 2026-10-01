# 🩺 Simulador Oposiciones SESCAM (v1.35.x)

Aplicación web avanzada y gamificada para preparar las oposiciones del **SESCAM**
(Ayudante de Cocina / Pinche, Celador y otras categorías). Diseño *Mobile-First*
de **tema oscuro** (con variante clara) y acentos **turquesa**, con un motor de
evaluación en tiempo real.

---

## ✨ Características

- **Tema oscuro con acentos turquesa** (`#1a1e2e` / contenedores `#242a3a`),
  **tema claro** conmutable y respeto por el tema del sistema. 100% responsivo.
- **Progreso en cascada** (Fuentes > Bloques > Temas) con **Media real de los
  intentos** (no solo el récord) y barras por nivel.
- **Estadísticas de actividad**: preguntas respondidas, **racha de días**,
  evolución de la nota, **acierto por fuente** y listas de **fallos** y
  **dudosas** repasables.
- **Gamificación**: récords con sello **Aprobado (verde) / Suspenso (rojo)**,
  **racha premium** (icono SVG), **meta diaria** (anillo de 3 tests/día), **frase
  motivacional** y **confeti** al sacar un 10 o un simulacro con nota ≥ 9.
- **Marcar preguntas como dudosas** para repasarlas cuando quieras.
- **Buscador de preguntas** por texto, con opción de hacer un test con los resultados.
- **Modo examen configurable**: nº de preguntas (10–40/todas) y tiempo
  (30 s / 1 min / 2 min / sin límite), con penalización oficial −1/3.
- **Navegación con historial** integrado ("Atrás" vuelve al submenú exacto).
- **Almacenamiento aislado** por usuario y rol, y **sincronización entre
  dispositivos** (fallos, dudosas, récords, historial y estadísticas).
- **Panel de administración**: crear usuarios, bloquear/desbloquear, **resetear
  contraseña** y **liberar dispositivos**.
- **Acceso seguro**: usuario + contraseña validados en el servidor, **token**,
  **RLS** activo, límite de **2 dispositivos** y **anti fuerza bruta**.
- **Exportar resultados en PDF** (notas y estadísticas, **sin las preguntas**).
- **Atajos de teclado**: `1`–`4` responder, `←`/`→` navegar.
- **PWA instalable** (manifest + iconos propios) con arranque offline del shell.

---

## 🛠 Modos de estudio

| Modo / Herramienta | Descripción |
|-------------------|-------------|
| 🏋️ **Entrenamiento** | Corrección inmediata en cada pregunta. Sin penalización. |
| 📝 **Simulacro Examen** | Sin corrección hasta el final. Penalización oficial **−1/3 por error**. |
| ❌ **Repaso de Fallos** | Banco de preguntas falladas. Se puede vaciar. |
| 🔖 **Repasar dudosas** | Test solo con las preguntas que hayas marcado. |
| 🔄 **Revisión** | Repaso visual de un test completado (con o sin filtro de fallos). |
| 🎲 **Modo Aleatorio** | Test a medida por nº de preguntas, fuentes, temario y tiempo. |
| 🔎 **Buscador** | Busca por texto y empieza un test con los resultados. |

---

## 📚 Fuentes de preguntas

| Fuente | Descripción |
|--------|-------------|
| **MAD** | Temario oficial editado (legislación y específicas). |
| **CSIF** | Banco de preguntas sindicales enfocadas al SESCAM. |
| **Academia** | Preguntas desglosadas por tema. |
| **Exámenes Oficiales** | OPE SESCAM 2026, 2024, 2020 (ordinario/extraordinario) e histórico. |

---

## 🏗️ Arquitectura y puesta en marcha

Frontend **100% estático** (módulos ES, sin build) servido por cualquier servidor
estático (GitHub Pages, Cloudflare Pages…). El acceso y los datos se apoyan en
Supabase (Edge Functions + Storage privado + tablas con RLS):

```
usuario + contraseña ──► login ─────────► usuarios_acceso (PBKDF2 + token, RLS)
    │  token              │  registra el dispositivo (límite 2, atómico)
    ├──► get-bank ────────┴──────────────► bucket PRIVADO "preguntas"
    ├──► admin-logs ─────────────────────► licencias/logs + acciones (solo es_admin)
    └──► sync-progress ──────────────────► tabla progreso (jsonb, RLS)
```

- **Acceso:** validado en el servidor (`login`), que devuelve un **token**. Las
  contraseñas se dan de alta con `node scripts/set_password.js`.
- **Licencia:** límite de **2 dispositivos** por código, verificado de forma
  **atómica** (RPC `registrar_dispositivo`). El overlay no se oculta hasta tener
  sesión válida.
- **Preguntas:** **no están en el repo**. Viven en un bucket privado y las sirve
  `get-bank`, que exige el token. Sin Supabase no hay preguntas (se muestra un
  aviso claro, nunca un fallo silencioso).
- **Detalles de seguridad y despliegue:** ver [`LICENCIAS.md`](LICENCIAS.md) §9.

### Desarrollo local

```bash
python -m http.server 8000      # o Live Server
```

### Backend (una sola vez)

Con un `.env` en la raíz (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`):

```bash
node scripts/deploy_backend.js    # sube los bancos y despliega las 4 funciones
node scripts/set_password.js ANA2026 "su-contraseña" --name "Ana"   # alta de usuario
```

O por separado:

```bash
node scripts/upload_banks.js      # data/*.json → bucket privado
supabase functions deploy login         --no-verify-jwt --project-ref <ref>
supabase functions deploy get-bank      --no-verify-jwt --project-ref <ref>
supabase functions deploy admin-logs    --no-verify-jwt --project-ref <ref>
supabase functions deploy sync-progress --no-verify-jwt --project-ref <ref>
node scripts/download_banks.js    # bucket privado → data/ (clon limpio)
```

El SQL de seguridad está en `supabase/sql/` (contraseñas, tabla de dispositivos,
tabla de progreso y **RLS**); hay que ejecutarlo una vez en el SQL Editor.

### Comprobaciones antes de subir cambios

```bash
node scripts/verify_refs.js        # estático (HTML/CSS/ids/tokens/versión…)
node scripts/test_storage.js       # aislamiento usuario+rol · dudosas · stats · media
node scripts/test_fullview.js      # vista completa en sus 3 modos
node scripts/test_data_loader.js   # carga de bancos y validación
node scripts/test_game_flow.js     # flujo normal de test (nota, récords…)
```

---

## 📖 Documentación

| Documento | Contenido |
|-----------|-----------|
| [`CHANGELOG.md`](CHANGELOG.md) | Historial de versiones versionado semánticamente. |
| [`AGENTS.md`](AGENTS.md) | Instrucciones para agentes/IA: reglas, arquitectura y prevención de regresiones. |
| [`LICENCIAS.md`](LICENCIAS.md) | Límite de dispositivos (RPC atómica), RLS, login con contraseña, rotación de claves y bancos por Supabase. |
| [`AUDITORIA.md`](AUDITORIA.md) | Estado de la auditoría y correcciones aplicadas. |

---

## 🔒 Reglas de oro (seguridad y sincronización)

1. **Sesión obligatoria:** no ocultar `#access-overlay` hasta que el login
   (o `Auth.checkAuth` con token) devuelva `onSuccess`.
2. **Aislamiento de progreso:** las claves de `localStorage` para resultados
   siguen el patrón `{prefijo}_{tema}_{bloque}` para que el progreso en cascada
   funcione por agregación de prefijos.
3. **La `service_role` nunca toca el frontend**, y con **RLS activo** el
   navegador no lee ni escribe las tablas; solo habla con `login`, `get-bank`,
   `admin-logs` y `sync-progress`.
4. **Claves locales del dispositivo** (no se sincronizan): la sesión suspendida
   y la **última categoría elegida** (`last_role`).

---

*Desarrollado con ❤️ y código limpio para dar el salto a la codiciada plaza blanca.*
