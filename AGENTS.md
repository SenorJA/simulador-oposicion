# OpenCode Agent Instructions — Simulador OPE SESCAM

This file provides high-signal context for future OpenCode/AI agent sessions to prevent regressions, security bypasses, and state corruption.

## 🛠 No-Build Static Architecture
- **Environment:** There are no bundlers, compilers, or package manager scripts. It is a 100% static frontend Single Page Application running directly in the browser using ES6 Modules (ESM).
- **Local Dev Server:** Start local development using any standard static server, such as:
  - `python -m http.server 8000`
  - Live Server (VS Code extension)

## 🔒 Security, Licensing & Data Access (STRICT)
- **Database/Licensing Lock:** Supabase enforces the 2-device license limit (`usuarios_acceso` and `access_logs` tables).
- **Data Access:** los bancos de preguntas NO viven en el repo. Se guardan en un bucket **privado** de Supabase Storage (`preguntas`) y los sirve la Edge Function `supabase/functions/get-bank`, que valida la licencia server-side con la `service_role`. El navegador solo habla con `get-bank`.
- **CRITICAL RESTRICTION:** Never alter, comment out, refactor, or bypass the authentication or Supabase connection logic (mainly in `src/js/modules/auth.js`, `src/js/main.js`, `db.js`) without explicit permission.
- **UI Rendering constraint:** The application interface must NOT render/show views (specifically hiding the `#access-overlay` login screens) until the security check promise `Auth.checkAuth` returns `onSuccess`.
- **NEVER put the `service_role` (or any `sb_secret_` key) in the frontend.** It lives only in the Edge Function environment and in the local `.env` used by the upload/download scripts. `config.js` only carries the publishable key.

## 📦 Import Quirks & Data Loading
- **STRICT PROHIBITION:** Do NOT append version query params or cache-busting suffixes (e.g. `?v=1.2`) to ES module imports inside Javascript files. Doing so loads duplicate singletons in the browser and breaks global state (e.g. `state.js` or `storage.js`). Imports must be clean:
  ```javascript
  import { state } from './state.js';
- **Banks are fetched as `POST /functions/v1/get-bank`** with `{ bank, user }`. The license code travels in the request body, never in the URL. `data.js` is the only module allowed to call `get-bank`.
- If you add a bank: put the JSON in `data/`, register it in the `BANKS` array, and run `node scripts/upload_banks.js` to push it to the private bucket. `verify_refs.js` fails if a local JSON is not registered.
- A bank that fails to load must never be silent: `fetchBank()` reports it, `loadAllData()` keeps the remaining banks, `showDataWarning()` shows `#data-warning`, and `getLastLoadReport()` exposes the full list for diagnostics.
- There is no offline fallback by design: if Supabase is down or paused, the app shows the data warning instead of serving stale files.
🗄️ Ingestion & Question Data Structure
- **`data/` is gitignored on purpose.** The banks live only in the private Storage bucket; `data/` is a local working copy used to upload and to run the tests. A clean clone has no `data/`: restore it with `node scripts/download_banks.js`.
- Sumative Only: Any addition of categories, exams, or questions in data/ or data.js must be sumative. Do not overwrite, rename, or delete existing variables, global arrays, or dictionaries mapping buttons to exams.
- Strict Format Verification: Validate JSON syntax thoroughly when appending large question sets. A malformed bank is discarded whole and reported; it must never crash the loader.
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

## 🎨 CSS Structure (single tokenized stylesheet)
- Everything lives in `css/style-v31.css`, organized by layers: tokens → reset → layout → components → responsive → accessibility.
- All colors, radii and shadows come from the `:root` token block. Do NOT hardcode a hex that already has a token, and do NOT leave a token defined-but-unused: `verify_refs.js` fails on both (`var(--x)` used but not defined, and defined-but-dead tokens).
- Never define the same selector twice in the same context (media queries count as a context). Duplicated blocks silently override each other; `verify_refs.js` fails if they reappear.
- Typography: `Inter` is loaded from Google Fonts in `index.html`. If you change the weights used in CSS, update the font URL too.
- Accessibility floor (must keep): `:focus-visible` styles for keyboard, `@media (prefers-reduced-motion: reduce)` to calm animations, and **no global `user-select: none`**.
- The stylesheet is cache-busted as `css/style-v31.css?v=<version>` in `index.html`; bump it with `CONFIG.APP_VERSION`.

## ♿ HTML & Accessibility Conventions
- **No inline `style=""` in `index.html`**; every presentational rule lives in the stylesheet. `verify_refs.js` fails if one reappears.
- Every class used in `index.html` must exist in the stylesheet; a missing rule is a bug. Reusable layout goes in the utility block (`.text-center`, `.m-0`, `.mt-40`…), one-off element tweaks use the element `id`.
- Decorative icons/SVGs get `aria-hidden="true" focusable="false"`. Icon-only buttons get `aria-label`.
- Overlays and modals use `role="dialog"`, `aria-modal="true"` and `aria-labelledby` pointing to their title.
- Dynamic counters (score, question number, timer) use `aria-live="polite"`; the data-failure banner uses `role="alert"`.

## 🧪 Verification Scripts (run before committing)
There is no build step, so correctness is checked with these Node scripts (from the repo root):
- `node scripts/verify_refs.js` — static checks: dead exports, `getElementById` targets present in `index.html`, orphan HTML ids, broken paths, resolved imports, forbidden `?v=` on imports, JSON validity, global ID uniqueness, mojibake, version consistency, that local `data/*.json` match `BANKS`, and CSS health (duplicate selectors, undefined/unused tokens, literal escape garbage, reduced-motion and focus-visible present).
- `node scripts/test_storage.js` — functional test of localStorage isolation between users and roles (needs no deps).
- `node scripts/test_fullview.js` — functional test of the continuous full view in its 3 modes (loads the real `state.js`, mocks `ui.js`/`storage.js`).
- `node scripts/test_data_loader.js` — functional test of the loader: mocks `get-bank`, checks the 17 banks, a failing bank, a truncated bank, 5 kinds of invalid question, that the dataset is byte-identical to the recorded SHA-256, and that the license never travels in the URL.
- The three tests above use `vm.SourceTextModule`, an experimental API. They include `scripts/vm-bootstrap.js`, which re-launches them with `--experimental-vm-modules` automatically, so run them exactly as written above.
- `node scripts/dataset_fingerprint.js` — prints a canonical SHA-256 of the whole dataset. Use it before/after any change to `data/` to prove the content did not shift.
- `node scripts/generate_icons.js` — regenerates the PWA PNG icons in `icons/` (no deps; writes `manifest.webmanifest` assets). Run it if the brand mark changes.
- `node scripts/upload_banks.js [--check]` — pushes `data/*.json` to the private bucket (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env`).
- `node scripts/download_banks.js [--check]` — restores `data/*.json` from the bucket (clean clone / backup).
- Data repair scripts accept `--check` to validate without writing: `node scripts/fix_duplicate_ids.js --check`, `node scripts/fix_csif_encoding.js --check`.
- Any `data/*.json` change must keep every JSON parseable and every `correcta` value present in that question's `opciones`.
- Question IDs must be unique within their file. Numeric IDs restart per file; prefix them (e.g. `mad_t11_155`) to avoid cross-topic collisions.
- Single source of truth for the version: `CONFIG.APP_VERSION` in `src/js/modules/config.js`. `index.html` must match it.
