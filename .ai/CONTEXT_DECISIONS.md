# Context & Decisions

### [2026-11-05] Washer usage statistics
- **Status:** Done
- **Objective:** Persist wash cycles and show device counters plus an app-settings dashboard with periods, monthly counts, program ranking and history.
- **Sources & Ingestion:**
  - **Figma:** None
  - **Slack / Communications:** User approved the statistics proposal in this conversation.
  - **Base Components Reused:** `lib/appliance-device.ts`, `drivers/washer/device.ts`, `settings/index.html`, `api.ts`
- **Decisions & Rationale (Why & How):**
  - Use the existing Homey TypeScript architecture; Android/Compose rules do not apply.
  - Store per-device statistics locally; distinguish completed, aborted and unverified cycles. Never infer successful completion from power-off.
  - Keep lifetime/monthly aggregates and the latest 500 cycle records. No reconstruction of pre-install program history or inferred energy/water measurements.
  - Preserve existing uncommitted spin-limit changes in the washer device.
  - Verification: all 16 automated tests passed (including headless Edge dashboard and mocked persistence/restart); Homey build and debug validation passed. No live Homey installation or appliance test performed.
- **Touched Files:**
  - `lib/wash-statistics.ts`
  - `lib/appliance-device.ts`
  - `drivers/washer/device.ts`
  - `settings/index.html`
  - `settings/statistics.js`
  - `api.ts`

### [2026-11-05] Project documentation
- **Status:** Done
- **Objective:** Document the project for developers: overview, setup, architecture, protocol, extension guide.
- **Sources & Ingestion:**
  - **Figma:** None
  - **Slack / Communications:** None
  - **Base Components Reused:** Existing `README.txt`, `docs/homey-flow-playbook.md`, `docs/official-client-test-plan.md`, source comments in `lib/`
- **Decisions & Rationale (Why & How):**
  - Written in English to match the code, commits and existing docs.
  - `README.md` is the developer entry point; `README.txt` stays the Homey App Store text. `*.md` is excluded from the app bundle via `.homeyignore`.
  - Deep technical content lives in `docs/architecture.md` to keep the README short.
  - AGENTS.md targets Android/Compose; this repo is a Homey TypeScript app, so the Android-specific rules (Compose, StateFlow, DESIGN_SYSTEM, LOCALIZATION) don't apply here.
- **Touched Files:**
  - `README.md`
  - `docs/architecture.md`
  - `.ai/PROJECT_MAP.md`
  - `.ai/CONTEXT_DECISIONS.md`
