# 🚨 REGLAS ESTRICTAS PARA ASISTENTES DE IA (LEER ANTES DE ACTUAR) 🚨

Actúas como un Desarrollador Senior. Este proyecto es una aplicación web (Simulador OPE) alojada en GitHub Pages. Antes de proponer o generar cualquier código para este proyecto, **DEBES** cumplir obligatoriamente las siguientes directrices:

## 1. SEGURIDAD Y CONTROL DE DISPOSITIVOS (INTOCABLE)
La aplicación utiliza Supabase EXCLUSIVAMENTE para un sistema de validación de licencias y bloqueo de dispositivos (DB Lock). 
* **PROHIBIDO:** Alterar, refactorizar, comentar o eliminar la lógica de autenticación, generación de UUID, o conexión a Supabase (usualmente en `auth.js`, `main.js` o `db.js`). 
* El renderizado de la UI siempre debe esperar a que la promesa de seguridad dé el "OK".

## 2. GESTIÓN DE ARCHIVOS Y CACHÉ (CERO EXPERIMENTOS)
El proyecto utiliza JavaScript moderno con ES Modules (`import`/`export`).
* **PROHIBIDO:** Añadir parámetros de versión o "cache-busting" (ej. `?v=1.2`) en las rutas de los `import` dentro de los archivos JS. Esto crea estados paralelos en memoria y destruye el acceso a los datos. Los imports deben ser estrictamente limpios: `import { variables } from './data.js';`.
* **Única excepción aprobada:** los `fetch` de JSON en crudo de `data.js` usan `?v=${CONFIG.APP_VERSION}`. El cache-busting es **por release**, nunca por visita: así el navegador reutiliza su caché entre visitas de la misma versión. `Date.now()` está prohibido también ahí (obligaba a bajar los ~2,7 MB en cada carga).

## 3. INTEGRACIÓN DE DATOS (`data.js`)
* Al añadir nuevos exámenes o preguntas al archivo de datos, la acción debe ser **SUMATIVA**. 
* **PROHIBIDO:** Sobrescribir, renombrar o eliminar las variables globales existentes (ej. `mad_`, `csif_`, exámenes anteriores) o romper el "diccionario" que mapea los botones con sus respectivos arrays.
* Verifica siempre la sintaxis (comas y corchetes) antes de entregar arrays JSON largos para evitar caídas totales de la app.
* Cada fichero nuevo de `data/*.json` se registra en el array `BANKS` de `data.js`. Si no, `verify_refs.js` falla.
* Un banco que no carga **nunca** falla en silencio: se avisa en `#data-warning`, se sigue con el resto, y `getLastLoadReport()` deja el detalle para diagnóstico.
* Antes de tocar `data/`, guarda la huella con `node scripts/dataset_fingerprint.js` y compárala después: el contenido no debe shifting sin querer.

## 4. HISTORIAL DE NAVEGACIÓN (UI)
* Al crear nuevos botones o flujos, respeta el `History Stack` de la aplicación.
* Evita crear bucles infinitos al usar los botones de "Volver" o "Ir al Menú".

**👉 INSTRUCCIÓN FINAL:** Si has entendido estas reglas, tu respuesta debe centrarse ÚNICAMENTE en la tarea solicitada, asegurando que ninguna de estas restricciones se viole en el código generado.