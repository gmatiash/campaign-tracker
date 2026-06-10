# Local setup & development

A Vite + React 18 + TypeScript single-page app. It runs **local-first** with no
account — data is stored in the browser (IndexedDB) — and switches to a cloud backend
only when the Supabase env vars are present (see STEP5-SUPABASE.md).

## Prerequisites
- **Node.js LTS** (18+). Not required if you only build via GitHub Actions (see Deploy).
- On **Windows**, keep the project on a plain path such as `C:\dev\campaign-tracker`.
  Avoid paths containing `&` (e.g. a `D&D` folder) — the shell can split the command —
  and prefer a path **outside OneDrive** to avoid sync/locking surprises.

## Run it from VS Code (or any terminal)
1. Open the project folder in VS Code.
2. Open the integrated terminal (`` Ctrl+` ``); it starts in the project folder.
3. First time: `npm install`.
4. `npm run dev`, then **Ctrl+Click** the printed URL
   (`http://localhost:5173/campaign-tracker/`).
5. Edit and save — the page hot-reloads. Stop with `Ctrl+C`.

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # production build into dist/
npm run typecheck  # tsc --noEmit (no local lint/test gate yet)
```

The header shows a `LOCAL` / `CLOUD` badge so you always know which backend is active.
In local mode, **Export** downloads a JSON backup and **Import** restores one.

## File tree
```
campaign-tracker/
├─ index.html
├─ package.json            # React 18, @supabase/supabase-js, lucide-react; Vite + TS
├─ tsconfig.json           # strict
├─ vite.config.ts          # base must equal "/<repo-name>/"
├─ .env.example            # copy to .env.local for cloud mode
├─ README.md  ARCHITECTURE.md  STEP1-SETUP.md  STEP5-SUPABASE.md
├─ .github/workflows/deploy.yml
├─ supabase/               # schema.sql, 02_members.sql, 03_storage.sql
└─ src/
   ├─ main.tsx
   ├─ app/                 # App shell, auth gate, members & invite panels
   ├─ core/
   │  ├─ domain/           # rules-agnostic models + entity factory
   │  ├─ ruleset/          # the Ruleset plugin contract + registry
   │  ├─ persistence/      # Repository + memory / indexeddb / supabase + io
   │  ├─ units.ts  assets.ts  gridDetect.ts
   ├─ systems/             # index.ts + dnd35/ (the only D&D-specific code)
   └─ modules/
      ├─ combat/           # CombatTracker + turnHistory (Undo)
      └─ map/              # MapView (grid, tokens, AoE, reach, fog/walls)
```

## Editing the code with an AI assistant
This chat can produce and revise files, but it can't reach your local machine or repo.
To let an AI edit files in place, use a local agent such as Claude Code from the same
terminal; otherwise paste in the files shared here. Each source file's first line is a
`// path` comment marking where it belongs relative to the project root.

## Type checking & conventions
- `npm run typecheck` runs `tsc --noEmit` (strict). There is no ESLint/Vitest gate yet;
  adding Vitest tests for the pure geometry (`aoeCells`, `reachCells`, stacking, grid
  detection) is the recommended next quality step.
- This app uses the modern JSX transform: import React types directly
  (`import type { CSSProperties } from "react"`), not via the `React.` namespace.
- Styling is inline (no CSS compiler). Icons are `lucide-react`; conditions also use
  emoji glyphs supplied by the ruleset.

## Deploy (GitHub Pages)
`.github/workflows/deploy.yml` builds and publishes on every push to `main`
(Node 22; `actions/checkout@v6`, `setup-node@v6`, `upload-pages-artifact@v4`,
`deploy-pages@v4`). One-time: **Settings → Pages → Source: GitHub Actions**. For cloud
mode on the live site, add the two `VITE_SUPABASE_*` values as **repository secrets**.
`base` in `vite.config.ts` must equal `"/<repo-name>/"`.
