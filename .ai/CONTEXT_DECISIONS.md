# Context & Decisions

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
