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
- Allowed Exception: Fetching JSON raw data (e.g., in data.js) uses cache-busting ?v=${Date.now()} which is correct and required.
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