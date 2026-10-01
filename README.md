# 🍳 Simulador OPE - SESCAM (v1.16.x)

Aplicación web avanzada y gamificada para preparar las oposiciones del **SESCAM** (Ayudante de Cocina / Pinche y futuras categorías). Diseño *Mobile-First* con estética *Premium Sanidad Teal* y un motor de evaluación en tiempo real.

---

## ✨ Características Principales y UX/UI

- **Estética "Sanatorio Teal"**: Colores institucionales, glassmorphism, sombras dinámicas y diseño 100% responsivo (optimizado para una columna en móvil y rejilla en PC).
- **Sistema de Progreso en Cascada**: Barras de progreso y nota media calculadas dinámicamente en 3 niveles de profundidad (Fuentes > Bloques > Temas/Partes) sin colisión de datos.
- **Gamificación y Récords Premium**: 
  - Sellos de completado estéticos (`✅ Completado | 🏆 Nota`).
  - Iconos dinámicos según el rendimiento: ❌ (<5), ✅ (5-6.9), 🎖️ (7-8.9), 🏆 (9-10).
- **Navegación Inteligente**: Historial de vistas integrado. El botón "Atrás" siempre devuelve al submenú exacto, evitando frustraciones de usabilidad.
- **Almacenamiento Persistente y Aislado**: Uso de `localStorage` con trazabilidad estricta. Historial de fallos y récords guardados entre sesiones sin mezclar partes de tests.

---

## 🛠 Modos de Estudio y Herramientas

| Modo / Herramienta | Descripción |
|-------------------|-------------|
| ⏱️ **Cronómetro Opcional** | *Modo Examen* (cuenta atrás y cierre) vs *Modo Zen/Repaso* (sin límite de tiempo). |
| 🏋️ **Entrenamiento** | Feedback inmediato en cada pregunta. Sin penalización. |
| 📝 **Examen Oficial** | Sin feedback hasta el final. Penalización oficial: **-1/3 por error**. |
| ❌ **Repaso de Fallos** | Banco de preguntas falladas históricamente. Posibilidad de borrar el historial. |
| 🔄 **Revisión** | Repaso visual de un test completado (con o sin filtro de fallos). |

---

## 📚 Fuentes de Preguntas y Temario

El motor separa el contenido por fuentes para un estudio estructurado:

| Fuente | Descripción |
|--------|-------------|
| **MAD** | Temario oficial editado (preguntas clásicas de legislación y específicas). |
| **CSIF** | Banco de preguntas sindicales enfocadas al SESCAM. |
| **Academia** | Preguntas desglosadas al detalle por tema. |
| **Exámenes Oficiales** | OPE SESCAM 2020 (ordinario y extraordinario), CCAA, Histórico. |

### Estado Actual del Temario (Ejemplo: Pinche de Cocina)

#### PARTE GENERAL (Temas 1–6)
| Tema | Título | Estado |
|------|--------|--------|
| Tema 1 | La Constitución Española de 1978 | ✅ |
| Tema 2 | Estatuto de Autonomía de CLM | ✅ |
| Tema 3 | Ley General de Sanidad y SESCAM | ✅ |
| Tema 4 | Ley de Ordenación Sanitaria de CLM | ✅ |
| Tema 5 | Estatuto Marco del Personal Estatutario | ✅ |
| Tema 6 | Régimen Jurídico del Personal Estatutario | 🔜 |

#### PARTE ESPECÍFICA (Temas 7–16)
| Tema | Título | Estado |
|------|--------|--------|
| Tema 8 | Ley de Prevención de Riesgos Laborales | ✅ (83 prev.) |
| Tema 9 | La Atención Primaria de Salud | ✅ (60 prev.) |
| Tema 10 | La Asistencia Especializada | ✅ (65 prev.) |
| Resto | Cocina, Alimentación, APPCC, Autoprotección… | 🔜 |

---

## 🏗️ Arquitectura y puesta en marcha

Frontend **100% estático** (ES Modules, sin build) servido por cualquier servidor
estático. Los datos y el acceso se apoyan en Supabase:

```
navegador ── checkAuth ─────────► usuarios_acceso (licencia, límite 2 dispositivos)
   │
   └────── POST {bank,user} ─────► Edge Function get-bank ──► bucket PRIVADO "preguntas"
```

- **Licencia:** 2 dispositivos por código. El overlay no se oculta hasta `onSuccess`.
- **Preguntas:** no están en el repo. Se guardan en un bucket privado y las sirve
  `get-bank`, que valida la licencia server-side. Sin Supabase no hay preguntas.
- **Detalles y puesta en marcha:** ver [`LICENCIAS.md`](LICENCIAS.md) §9.

### Desarrollo local

```bash
python -m http.server 8000      # o Live Server
```

Para subir/restaurar los bancos (necesita `.env` con `SUPABASE_SERVICE_ROLE_KEY`):

```bash
node scripts/upload_banks.js      # data/*.json → bucket privado
node scripts/download_banks.js    # bucket privado → data/ (clon limpio)
```

Comprobaciones antes de subir cambios:

```bash
node scripts/verify_refs.js
node scripts/test_storage.js
node scripts/test_fullview.js
node scripts/test_data_loader.js
```

---

## 🔒 Reglas de Oro (Seguridad y Sincronización)

Para evitar regresiones en futuras actualizaciones, se deben respetar estos pilares:

1.  **Validación de Dispositivo Obligatoria**: No se debe ocultar el `access-overlay` hasta que `Auth.checkAuth` devuelva `onSuccess`.
2.  **Lógica de Auto-Recuperación (Self-Healing)**: El sistema no confía solo en el `localStorage`. Si el contador de la DB es incoherente (ej. tras un reseteo manual), el código consulta el historial de `access_logs` para detectar cambios de hardware y reparar el contador automáticamente.
3.  **Aislamiento de Progreso**: Las claves de `localStorage` para resultados deben seguir el patrón `{prefijo}_{tema}_{bloque}` para asegurar que el "Progreso en Cascada" funcione por agregación de prefijos.

---

*Desarrollado con ❤️ y código limpio para dar el salto a la codiciada plaza blanca.*
