# OpenCode Agent Instructions — Simulador OPE SESCAM

This file provides high-signal context for future OpenCode/AI agent sessions to prevent regressions, security bypasses, and state corruption.

## 🛠 No-Build Static Architecture
- **Environment:** There are no bundlers, compilers, or package manager scripts. It is a 100% static frontend Single Page Application running directly in the browser using ES6 Modules (ESM).
- **Local Dev Server:** Start local development using any standard static server, such as:
  - `python -m http.server 8000`
  - Live Server (VS Code extension)

## 🔒 Security & Device License System (STRICT)
- **Database/Licensing Lock:** Supabase is used EXCLUSIVELY to enforce a 2-device license limit (`usuarios_acceso` and `access_logs` tables).
- **CRITICAL RESTRICTION:** Never alter, comment out, refactor, or bypass the authentication or Supabase connection logic (mainly in `src/js/modules/auth.js`, `src/js/main.js`, `db.js`). 
- **UI Rendering constraint:** The application interface must NOT render/show views (specifically hiding the `#access-overlay` login screens) until the security check promise `Auth.checkAuth` returns `onSuccess`.

## 📦 Import Quirks & Cache-Busting
- **STRICT PROHIBITION:** Do NOT append version query params or cache-busting suffixes (e.g. `?v=1.2`) to ES module imports inside Javascript files. Doing so loads duplicate singletons in the browser and breaks global state (e.g. `state.js` or `storage.js`). Imports must be clean:
  ```javascript
  import { state } from './state.js';
- **Raw JSON fetches use `?v=${CONFIG.APP_VERSION}`** (approved change, `data.js` only). Busting by release, not by visit: the browser reuses its HTTP cache between visits of the same release, and a new release invalidates it. `Date.now()` is forbidden here too — it defeated the cache and re-downloaded ~2.7 MB on every page load. The cache key must never be a timestamp.
- **`data.js` is the only place allowed to build cache keys.** If you add a bank, register it in the `BANKS` array; `verify_refs.js` fails if a JSON in `data/` is not registered.
- A bank that fails to load must never be silent: `fetchBank()` reports it, `loadAllData()` keeps the remaining banks, `showDataWarning()` shows `#data-warning`, and `getLastLoadReport()` exposes the full list for diagnostics.
🗄️ Ingestion & Question Data Structure
- Sumative Only: Any addition of categories, exams, or questions in data/ or data.js must be sumative. Do not overwrite, rename, or delete existing variables, global arrays, or dictionaries mapping buttons to exams.
- Strict Format Verification: Validate JSON syntax thoroughly when appending large question sets. If a JSON file fails to parse, the entire application fails to boot.
- Preprocessing Scripts: There is a suite of custom python and JS scripts in /scripts/ for data cleaning, duplicate checking, and scraping. Run them directly (e.g., node scripts/check.js, python scripts/check_dupes.py).
🗺️ Navigation & History Stack
- Browser History Integration: The application uses a custom History Stack coupled with window.onpopstate and UI.goBack().
- Constraint: Use the central navigation routing UI.showView(viewName) rather than direct DOM class modifications (classList.add/remove('hidden')) to ensure back history is kept in sync and to prevent infinite navigation loops.
💾 LocalStorage & Role Isolation
- Prefix Isolation: LocalStorage keys for failures and progress must use the dynamic currentPrefix (derived from user license ID + current active role e.g. pinche vs celador) to ensure absolute user and category isolation.
- Key Pattern: Failure keys must follow the precise {prefix}_{tema}_{bloque} format to enable cascading progress calculations.
- `currentPrefix` is `u_{id}_` for pinche and `u_{id}_celador_` for celador. Only `storage.js` builds these prefixes via `pk(key)`.
- **ALL user data keys MUST go through `pk()`**: failures, progress, records and the suspended session. Never write a bare `localStorage.setItem('simulador_sescam_records', ...)` or `'estado_test_suspendido'` — that data would be shared between users on the same browser.
- When adding a new user-scoped key: add it to `KEYS`, list it in `pk()`, and migrate any legacy unprefixed key lazily inside its getter (adopt the old value into the prefixed key, then delete the old one).
- Switching roles must refresh any role-scoped UI: call `Storage.setRole(role)` then re-render records/progress/failures.

## 🧪 Verification Scripts (run before committing)
There is no build step, so correctness is checked with these Node scripts (from the repo root):
- `node scripts/verify_refs.js` — static checks: dead exports, `getElementById` targets present in `index.html`, orphan HTML ids, broken paths, resolved imports, forbidden `?v=` on imports, JSON validity, global ID uniqueness, mojibake, version consistency, and that every `data/*.json` is registered in `BANKS`.
- `node scripts/test_storage.js` — functional test of localStorage isolation between users and roles (needs no deps).
- `node scripts/test_fullview.js` — functional test of the continuous full view in its 3 modes (loads the real `state.js`, mocks `ui.js`/`storage.js`).
- `node scripts/test_data_loader.js` — functional test of the JSON loader: 17 banks, a failing bank, a truncated JSON, 5 kinds of invalid question, and that the loaded dataset is byte-identical to the recorded SHA-256.
- The three tests above use `vm.SourceTextModule`, an experimental API. They include `scripts/vm-bootstrap.js`, which re-launches them with `--experimental-vm-modules` automatically, so run them exactly as written above.
- `node scripts/dataset_fingerprint.js` — prints a canonical SHA-256 of the whole dataset. Use it before/after any change to `data/` to prove the content did not shift.
- Data repair scripts accept `--check` to validate without writing: `node scripts/fix_duplicate_ids.js --check`, `node scripts/fix_csif_encoding.js --check`.
- Any `data/*.json` change must keep every JSON parseable and every `correcta` value present in that question's `opciones`.
- Question IDs must be unique within their file. Numeric IDs restart per file; prefix them (e.g. `mad_t11_155`) to avoid cross-topic collisions.
- Single source of truth for the version: `CONFIG.APP_VERSION` in `src/js/modules/config.js`. `index.html` must match it.
