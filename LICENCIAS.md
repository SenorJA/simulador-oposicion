# Sistema de licencias y dispositivos — comportamiento y límites

Documento de referencia del límite de accesos. Describe **lo que el código hace
realmente hoy**, no lo que debería hacer. No modifica `auth.js`.

> Restricción permanente: cualquier cambio en `src/js/modules/auth.js` o en la
> conexión con Supabase requiere autorización explícita del usuario.

---

## 1. Cómo funciona hoy

Flujo en `src/js/modules/auth.js` → `checkAuth()` → `validateUserAccess()`:

1. El código de usuario llega por `?user=CODIGO` en la URL o por
   `localStorage` (`Storage.getSavedUser()`). Si no hay ninguno, se deniega.
2. `initSupabase()` crea el cliente con `CONFIG.SUPABASE_URL` y
   `CONFIG.SUPABASE_KEY`.
3. Busca la fila en `usuarios_acceso` con `.ilike('id_acceso', userId)` — la
   búsqueda **no distingue mayúsculas**, pero luego se usa el `id_acceso` real
   de la fila (`exactId`) para todo lo demás.
4. Si la fila no existe → `onDenied`. Si `bloqueado === true` → `onDenied`.
5. Guarda el usuario y hace `Storage.setPrefix(exactId)` para aislar el progreso.
6. Cuenta los dispositivos (ver sección 2).
7. Inserta un log en `access_logs` y llama a `onSuccess`.

**El límite es `MAX_DEVICES = 2` (auth.js:9).**

`main.js` no muestra ninguna vista hasta que `onSuccess` se dispara, así que el
overlay `#access-overlay` permanece visible en cualquier camino de fallo.

---

## 2. El contador de dispositivos

Estado que se usa:

| Dato | Origen | Clave |
|---|---|---|
| Contador | `usuarios_acceso.dispositivos_usados` | servidor |
| Identidad del dispositivo | `localStorage` | `ope_reg_v2_<id_acceso>` |
| Historial | `access_logs.device_info` | servidor |

`Storage.getOrCreateDeviceId()` genera un ID persistente por navegador
(localStorage, sobrevive recargas).

`ope_reg_v2_<id_acceso>` guarda el `deviceId` del navegador. Si coincide con el
dispositivo actual, se considera "ya registrado" y no se incrementa el contador.

### Reglas de decisión (auth.js:74-136)

- `currentDBCount === 0` → se invalida el registro local
  (`isRegisteredLocally = false`, auth.js:78). La DB manda sobre el localStorage.
- **Self-healing** (auth.js:85-107): si el dispositivo localmente registrado ve
  que `currentDBCount < MAX_DEVICES`, consulta el último log y compara el
  `shortId` (10 primeros caracteres del deviceId). Si el último log pertenece a
  **otro** dispositivo, fuerza `needsIncrement = true`.
- Si `needsIncrement` y `currentDBCount >= MAX_DEVICES` y no está registrado
  localmente → **bloquea** (auth.js:110).
- Si `currentDBCount < MAX_DEVICES` → incrementa a `currentDBCount + 1`
  (auth.js:120-135).

### Ejemplo de caso problemático

| Situación | Resultado |
|---|---|
| Navegador A, contador 2, `ope_reg_v2` = A, último log de A | Pasa (0/1) |
| Navegador B, contador 2, sin registro local | **Bloqueado** |
| Navegador A, contador 1, `ope_reg_v2` = A, último log de B | Self-healing → contador sube a 2, **pasa** |
| Navegador A, contador 1, `ope_reg_v2` = A, `access_logs` vacío | `lastLogs.length === 0` → no repara → contador queda en 1, **pasa sin registrar** |

---

## 3. Respuestas a las preguntas frecuentes

### «¿Se bloquea si falla el registro de usuarios?»

**No se puede distinguir un fallo de red de un código inválido con el
comportamiento actual, pero los caminos sí son distintos:**

| Fallo | `error` de Supabase | Mensaje | ¿Se reintenta? |
|---|---|---|---|
| Código no existe | `PGRST116` (0 filas) | "Código de usuario inválido o no encontrado" | Manual, con otro código |
| Tabla/RLS caída | Error de red o de Postgres | "Error de conexión al validar el acceso" (auth.js:154) | **Automático**, botón "Reintentar" |
| `supabase` no cargó | — | "Error: Supabase no inicializado." (auth.js:41) | **Automático**, botón "Reintentar" |
| `access_logs` falla al insertar | Se ignora (`catch`, auth.js:148) | Ninguno, el acceso **se concede** | — |

**Consecuencia importante:** si la escritura de `access_logs` falla pero la
actualización de `dispositivos_usados` sí pasó, el contador sube sin log. El
self-healing se apoya justamente en los logs, así que un corte de red
parcial puede desincronizar ambos.

### «Dos códigos del mismo usuario, ¿se bloquea en el 3.er dispositivo?»

No se puede detectar, y **ese es el límite estructural actual**: el contador vive
en la fila de `usuarios_acceso`, así que es **por código, no por persona**.

- Un código → 2 dispositivos.
- Dos códigos del mismo titular → hasta **4 dispositivos** (2 por código).
- La app no tiene ningún dato de identidad (correo, DNI, teléfono) con el que
  correlacionar códigos, y no los tiene porque no está en el modelo de datos.

Si el requisito de negocio es "2 dispositivos por persona", hace falta un campo
de identidad en `usuarios_acceso` y una consulta que lo use. Eso es un cambio de
esquema, no de frontend.

### «Y si pasa a más dispositivos con el mismo código?»

El 3.er navegador queda bloqueado (auth.js:110). La única vía de salida es
resetear `dispositivos_usados` a mano desde el panel de Supabase.

---

## 4. Riesgos conocidos

| # | Riesgo | Dónde | Impacto |
|---|---|---|---|
| 1 | **Carrera en el registro** | auth.js:120-135 | El contador se lee y se escribe desde el cliente, sin transacción. Dos navegadores nuevos a la vez pueden leer ambos `1` y escribir ambos `2` → el tercer dispositivo entra sin bloqueo. El límite se puede superar. |
| 2 | **El cliente controla el contador** | auth.js:122-126 | `.update({ dispositivos_usados: newCount })` sin condición de "solo si sigue valiendo". Un cliente modificado puede fijar el valor que quiera. |
| 3 | **RLS sin verificar** | `usuarios_acceso` | Sin `RLS` + políticas, la `anon key` pública permite leer/escribir la tabla. La clave está en `config.js` y es pública por diseño. |
| 4 | **Errores de log tragados** | auth.js:148, auth.js:189 | `logAccess` y el log de éxito silencian errores. El self-healing depende de esos logs. |
| 5 | **`ADMIN_USER` en el frontend** | `config.js:4` | Solo controla qué código ve el panel de admin en la UI. **No es una barrera de seguridad**: el control real debe estar en la DB. |
| 6 | **Clave Supabase antigua expuesta** | historial de Git | Un proyecto Supabase anterior (`eykwcwgplldapzjnxuym.supabase.co`) tiene credenciales en el historial; el proyecto activo es `ictintjdebutsjkbexpc.supabase.co`. Hay que rotar la clave antigua y dar de baja ese proyecto. |
| 7 | **Sin rate limit** | `usuarios_acceso` | Se pueden probar códigos a voluntad hasta agotar los 2 huecos del código. |

---

## 5. La solución real: RPC transaccional (NO aplicada)

Los riesgos 1 y 2 se resuelven moviendo el contador a una función de base de
datos. La app ya llama a Supabase; una RPC elimina la carrera y quita al cliente
la posibilidad de fijar el contador.

```sql
-- NO APLICADO. Requiere cambiar auth.js, que está congelado.
create or replace function public.registrar_dispositivo(
    p_id_acceso text,
    p_device_id text,
    p_maximo    int default 2
)
returns table (ok boolean, contador int, motivo text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fila       usuarios_acceso%rowtype;
    v_registrado int;
begin
    select * into v_fila
      from usuarios_acceso
     where id_acceso = p_id_acceso
       and bloqueado is not true
     for update;                    -- serializa lectura y escritura

    if not found then
        return query select false, 0, 'CODIGO_INVALIDO';
        return;
    end if;

    select count(*) into v_registrado
      from access_logs
     where device_info like '%(' || v_fila.id_acceso || ')%'
       and device_info like '%' || p_device_id || '%'
       and status = 'success';

    if v_registrado > 0 then
        return query select true, v_fila.dispositivos_usados, 'YA_REGISTRADO';
        return;
    end if;

    if v_fila.dispositivos_usados >= p_maximo then
        return query select false, v_fila.dispositivos_usados, 'LIMITE_ALCANZADO';
        return;
    end if;

    update usuarios_acceso
       set dispositivos_usados = dispositivos_usados + 1
     where id_acceso = v_fila.id_acceso;

    insert into access_logs (created_at, status, device_info)
    values (now(), 'success',
            v_fila.nombre || ' (' || v_fila.id_acceso || ') — '
            || (v_fila.dispositivos_usados + 1) || '/' || p_maximo
            || ' — RPC — ' || left(p_device_id, 10));

    return query select true, v_fila.dispositivos_usados + 1, 'REGISTRADO';
end;
$$;

revoke all on function public.registrar_dispositivo from public, anon, authenticated;
```

Con `for update` la fila queda bloqueada durante la transacción, así que dos
navegadores simultáneos se serializan: el segundo ve el contador ya incrementado
y recibe `LIMITE_ALCANZADO`.

**Estado: redactado, NO aplicado.** Antes de aplicarlo hace falta:

1. Verificar/aplicar RLS en `usuarios_acceso` y `access_logs` (riesgo 3).
2. Cambiar `auth.js` para llamar a la RPC en vez de hacer `select` + `update`
   desde el cliente. **Requiere autorización explícita.**
3. Decidir qué hacer con los contadores que ya quedaron desincronizados.

---

## 6. Procedimiento de recuperación

Para desbloquear a un usuario legítimo sin tocar código:

```sql
-- 1. Ver el estado actual
select id_acceso, nombre, bloqueado, dispositivos_usados
  from usuarios_acceso
 where id_acceso ilike 'CODIGO_A_BUSCAR';

-- 2. Resetear el contador (el dispositivo actual se re-registra solo)
update usuarios_acceso set dispositivos_usados = 0
 where id_acceso ilike 'CODIGO_A_BUSCAR';

-- 3. Desbloquear
update usuarios_acceso set bloqueado = false
 where id_acceso ilike 'CODIGO_A_BUSCAR';
```

Tras el reset, el siguiente navegador que entre ocupa un hueco y queda registrado
con el `device_id` de ese navegador.

### Cuándo NO usar el reset

Un contador a 1 con un solo dispositivo real **no** significa que sobre un hueco.
Puede ser un caso de self-healing mal disparado o un log borrado. Antes de
resetear, comparar con la columna `device_info` de `access_logs`.

---

## 7. Reglas permanentes

1. **No fail-open.** Si Supabase no responde, la app bloquea. Convertirlo en
   "dejar pasar" convertiría un fallo de red en un bypass del licensing. El
   botón "Reintentar" y el aviso explícito son la respuesta correcta.
2. **No subir `MAX_DEVICES` como arreglo.** El límite es una decisión de negocio,
   no un bug.
3. **La barrera de seguridad es la DB**, no el frontend. `CONFIG.ADMIN_USER` y
   cualquier `if` en `auth.js` son solo UX.
4. **El contenido ya no es estático ni público.** Los bancos de preguntas viven
   en un bucket **privado** de Supabase Storage y los sirve la Edge Function
   `get-bank` tras validar la licencia (ver §9). Un usuario **con licencia** sí
   puede copiar lo que ve: esto frena a desconocidos, no a un usuario legítimo.

---

## 8. Inventario de claves y rotación

**El repo es público**, así que las claves han estado y estarán en el historial.
Reescribirlo no las borra de verdad (hay clones y cachés de GitHub). La solución
es **rotar o dar de baja los proyectos**, no el force-push.

### Qué se filtró realmente

| Proyecto | Tipo de clave | Rol | Estado |
|---|---|---|---|
| `ictintjdebutsjkbexpc` | `sb_publishable_…` | publishable | **en uso** |
| `eykwcwgplldapzjnxuym` | JWT | anon | antiguo |
| `fthltpsnuhwghclzvexi` | JWT | anon | antiguo |

- **Nunca se filtró una `service_role` ni una `sb_secret_`.** Verificado sobre
  todo el historial con `git log --all -p | grep sb_secret_`.
- Las claves `anon` y `publishable` están **diseñadas para ir en el navegador**:
  son públicas a propósito. Rotarlas aporta poco por sí solo; lo que cierra el
  agujero es **RLS** (§4, riesgo 3).

### Pasos de rotación

**A) Proyectos antiguos (lo más rentable).** Dashboard → Project Settings →
General → *Pause* o *Delete project*. Eso inutiliza todas sus claves de golpe.
Si no se usan, borrarlos.

**B) Proyecto actual, para rotar la publishable:**

1. Project Settings → **API Keys** → Publishable key → *Rotate/Create new*.
2. Pegar la nueva en `src/js/modules/config.js` → `SUPABASE_KEY`.
3. Subir `CONFIG.APP_VERSION` en `config.js` **y** el `?v=` del `<script>` en
   `index.html`; si no, los navegadores siguen con la clave vieja en caché.
4. Commit y push.
5. Revocar la clave vieja en el panel.
6. Verificar que la vieja ya no vale:
   `curl -H "apikey: VIEJA" https://<ref>.supabase.co/rest/v1/` → `401`.

**C) Cerrar el agujero de verdad (RLS).** Table Editor → `usuarios_acceso` y
`access_logs` → comprobar el badge **RLS**. Si está *disabled*, cualquiera con
la clave pública lee y modifica licencias. Activar RLS sin más **rompe la app**
(el cliente hace `UPDATE dispositivos_usados` directo); la vía limpia es la RPC
de §5, que exige tocar `auth.js`.

### Nota operativa

Los proyectos pausados no responden: la app mostrará "Error de conexión al
validar el acceso" con botón **Reintentar**. Es el comportamiento esperado
(§3), no un fallo de código. Reactivar el proyecto desde el panel antes de
probar.

---

## 9. Bancos de preguntas servidos por Supabase

Los JSON ya **no están en el repo público**. Se sirven así:

```
app (navegador)  --POST {bank,user}-->  Edge Function get-bank
                                            │ valida licencia (service_role)
                                            ▼
                                bucket PRIVADO "preguntas"
```

- `data/` está en `.gitignore`: es solo una copia local para subir y testear.
- El código de licencia viaja en el **cuerpo** de la petición, nunca en la URL.
- La `service_role` solo existe en el entorno de la función y en el `.env` local
  de los scripts. **Jamás** en `config.js`.

### Puesta en marcha (una vez)

1. Instalar la CLI: `npm i -g supabase` (o `scoop`/`brew`).
2. En la raíz del repo, crear `.env` (gitignored):
   ```
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
   ```
3. Subir los bancos (crea el bucket privado y sube los 17 JSON):
   ```
   node scripts/upload_banks.js
   ```
4. Desplegar la función **sin verificación de JWT** (la puerta es la licencia):
   ```
   supabase functions deploy get-bank --no-verify-jwt --project-ref <ref>
   ```

### Verificación

- `node scripts/upload_banks.js --check` — lista lo que se subiría, sin tocar nada.
- `node scripts/download_banks.js --check` — lista lo que hay en el bucket.
- Directo al bucket (con la `apikey` pública) debe dar **400/404**, no el JSON:
  ```
  curl -s -o /dev/null -w "%{http_code}" \
    "https://<ref>.supabase.co/storage/v1/object/public/preguntas/preguntas.json"
  ```
- `get-bank` con un código inválido debe dar **403**.

### Coste y límites

- Egress: cada carga descarga ~1,8 MB. El plan gratuito de Supabase son 5 GB/mes
  → unas **2.700 cargas**; a partir de ahí, a pagar.
- Sin Supabase no hay preguntas: la app muestra el aviso de carga incompleta
  (§7.1). No hay copia local de respaldo, por diseño.
- Endurecimiento futuro (no aplicado): rate limit por código en la función,
  comprobar el límite de dispositivos dentro de `get-bank` y firmar las URLs.

### ⚠️ Riesgo residual: el historial de Git

Sacar `data/` de la rama `main` **no borra** los bancos del repo. Están en cada
commit anterior a `31583e4`. Verificado: la URL cruda de un commit antiguo
sigue devolviendo el JSON completo (`HTTP 200`, ~1,8 MB) sin autenticación.

Mientras el repo siga siendo **público**, cualquiera puede recuperarlos del
historial. Opciones para cerrarlo de verdad:

| Opción | Qué hace | Coste |
|---|---|---|
| **Repo privado** (recomendado) | Deja de servir el historial sin login. La app aún no está publicada, así que no rompe nada. | Un clic en Settings; luego revisar si el hosting necesita el repo público |
| Reescribir historia | `git filter-repo --path data/ --invert-paths` + force-push. Borra los objetos alcanzables. | Rompe clones; GitHub puede conservar objetos hasta su GC |
| Borrar y recrear el repo | Limpio del todo. | Se pierde el historial de commits |

El `data/` que ahora está en `.gitignore` solo protege los commits **futuros**.
La decisión de privatizar el repo es del titular.
