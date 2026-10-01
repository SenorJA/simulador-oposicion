# 🩺 Simulador Oposiciones SESCAM (v1.19.x)

Aplicación web avanzada y gamificada para preparar las oposiciones del **SESCAM**
(Ayudante de Cocina / Pinche, Celador y otras categorías). Diseño *Mobile-First*
de **tema oscuro** (fondo azul-gris muy oscuro) con acentos **turquesa** y un
motor de evaluación en tiempo real.

---

## ✨ Características

- **Tema oscuro con acentos turquesa**: fondo `#1a1e2e`, contenedores `#242a3a`
  (radio 16px), texto claro y acento turquesa `#38bdf8`; 100% responsivo.
  Colores vivos para aciertos/errores.
- **Sistema de progreso en cascada**: barras y nota media en 3 niveles
  (Fuentes > Bloques > Temas) sin colisión de datos.
- **Estadísticas por tema** y **lista de fallos** repasables en "Mi Progreso".
- **Gamificación y récords**: sellos de completado e iconos por rendimiento
  (❌ <5 · ✅ 5–6.9 · 🎖️ 7–8.9 · 🏆 9–10).
- **Navegación con historial integrado**: "Atrás" siempre vuelve al submenú exacto.
- **Almacenamiento persistente y aislado** por usuario y rol (`localStorage`).
- **Atajos de teclado**: `1`–`4` para responder, `←`/`→` para navegar.
- **PWA instalable** (manifest + iconos propios) con arranque offline del shell.
- **Export/import del progreso** (JSON) para no perderlo al cambiar de navegador.

---

## 🛠 Modos de estudio

| Modo / Herramienta | Descripción |
|-------------------|-------------|
| 🏋️ **Entrenamiento** | Corrección inmediata en cada pregunta. Sin penalización. |
| 📝 **Simulacro Examen** | Sin corrección hasta el final. Penalización oficial **−1/3 por error**. Permite elegir nº de preguntas (10–40 o todas) y tiempo (30 s / 1 min / 2 min / sin límite). |
| ❌ **Repaso de Fallos** | Banco de preguntas falladas. Posibilidad de vaciarlo. |
| 🔄 **Revisión** | Repaso visual de un test completado (con o sin filtro de fallos). |
| 🎲 **Modo Aleatorio** | Test a medida por nº de preguntas, fuentes, temario y tiempo. |

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
Supabase:

```
navegador ── Auth.checkAuth ──► usuarios_acceso (licencia · límite 2 dispositivos)
   │
   └────── POST {bank,user} ───► Edge Function get-bank ──► bucket PRIVADO "preguntas"
```

- **Licencia:** 2 dispositivos por código. El overlay no se oculta hasta `onSuccess`.
- **Preguntas:** no están en el repo. Viven en un bucket privado y las sirve
  `get-bank`, que valida la licencia en el servidor. Sin Supabase no hay preguntas
  (se muestra un aviso claro, nunca un fallo silencioso).
- **Detalles de seguridad y despliegue:** ver [`LICENCIAS.md`](LICENCIAS.md) §9.

### Desarrollo local

```bash
python -m http.server 8000      # o Live Server
```

### Backend (una sola vez)

Con un `.env` en la raíz (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`):

```bash
node scripts/deploy_backend.js    # sube los bancos y despliega get-bank
```

O por separado:

```bash
node scripts/upload_banks.js      # data/*.json → bucket privado
supabase functions deploy get-bank --no-verify-jwt --project-ref <ref>
node scripts/download_banks.js    # bucket privado → data/ (clon limpio)
```

### Comprobaciones antes de subir cambios

```bash
node scripts/verify_refs.js        # estático (HTML/CSS/ids/tokens/versión…)
node scripts/test_storage.js       # aislamiento por usuario+rol · export/import
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
| [`LICENCIAS.md`](LICENCIAS.md) | Límite de dispositivos, riesgos, RPC no aplicada, rotación de claves y bancos por Supabase. |
| [`AUDITORIA.md`](AUDITORIA.md) | Estado de la auditoría y correcciones aplicadas. |

---

## 🔒 Reglas de oro (seguridad y sincronización)

1. **Validación de dispositivo obligatoria:** no ocultar `#access-overlay` hasta
   que `Auth.checkAuth` devuelva `onSuccess`.
2. **Aislamiento de progreso:** las claves de `localStorage` para resultados
   siguen el patrón `{prefijo}_{tema}_{bloque}` para que el progreso en cascada
   funcione por agregación de prefijos.
3. **La `service_role` nunca toca el frontend:** vive solo en la Edge Function y
   en el `.env` local de los scripts.

---

*Desarrollado con ❤️ y código limpio para dar el salto a la codiciada plaza blanca.*
