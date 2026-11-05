# AGENTS.md — Universal Android AI Agent Operating System

This configuration file governs all AI assistants (Gemini, Claude, ChatGPT, Cursor, Copilot) operating within this repository.
All rules, autonomous logging triggers, and context maintenance procedures defined below are mandatory.

---

## 1. Context File Architecture
To maintain a clean, persistent project memory, all agents MUST read, utilize, and autonomously update the following specialized files located in the `.ai/` directory:

| File | Purpose | Autonomous Trigger |
| :--- | :--- | :--- |
| `.ai/CONTEXT_DECISIONS.md` | Feature traceability, Slack/Figma links, active draft context, decision logs with timestamps | **AUTOMATIC:** Created/updated immediately whenever user provides external links or mixed requirements BEFORE writing code. |
| `.ai/PROJECT_MAP.md` | Module structure, package layers, entry points, navigation | **AUTOMATIC:** Updated when modules, packages, or core navigation flows are created/renamed. |
| `.ai/PROJECT_REQUIREMENTS.md`| Custom project-specific domain rules & overrides | Read prior to implementation; updated when project scope evolves. |
| `.ai/DESIGN_SYSTEM.md` | Color tokens, typography, shapes, reusable UI components | Consulted before UI work; updated when a new reusable composable is introduced. |
| `.ai/LOCALIZATION.md` | Target locales (e.g., `values-cs`), string conventions | Checked for every UI text; updated when new target languages are added. |
| `.ai/ERRORS_INBOX.md` | Raw error logs, crash traces, unverified lint findings | Ingests raw findings during audits prior to task prioritization. |
| `.ai/TODO_AI.md` | Actionable, prioritized development checklist | Populated from triage; updated (`[x]`) upon task completion. |

---

## 2. Core Android Engineering Standards
- **Language:** Modern, idiomatic Kotlin exclusively.
- **UI Framework:** Jetpack Compose with Material 3. Legacy XML layouts are strictly forbidden.
- **Architecture:** Unidirectional Data Flow (UDF) strictly separating `UI -> Domain -> Data`.
- **State Management:** `StateFlow` collected via `collectAsStateWithLifecycle()` in Compose. Do not use `LiveData`.
- **Concurrency:** Kotlin Coroutines. Explicit dispatchers required (`Dispatchers.IO` for I/O, `Dispatchers.Default` for CPU operations). Never use `GlobalScope`.
- **Localization:** Zero hardcoded strings in Compose. Always use `stringResource(R.string.key)` and verify keys across all target locales defined in `LOCALIZATION.md`.
- **Previews:** Every composable screen and standalone component must feature a `@Preview` with representative mock data.

---

## 3. Autonomous Ingestion & Context Logging (`CONTEXT_DECISIONS.md`)

Whenever the user inputs unstructured requirements, links to external systems (Slack, Figma, Jira, docs), or requests mixing existing components into a new feature:

### The Autonomous Ingestion Workflow
1. **DO NOT start coding immediately.**
2. Check if `.ai/` directory and `.ai/CONTEXT_DECISIONS.md` exist. If not, create them.
3. Automatically append a new timestamped entry to `.ai/CONTEXT_DECISIONS.md` using the exact structure below.
4. If an entry for the component/feature already exists, update its status, append the new decision, and adjust references.

### Entry Format for `.ai/CONTEXT_DECISIONS.md`:
```markdown
### [YYYY-MM-DD] [Feature / Component Name]
- **Status:** In Progress
- **Objective:** Concise summary of what is being built and why.
- **Sources & Ingestion:**
  - **Figma:** <URL / Frame ID None>
  - **Slack / Communications:** <URL / Quote Summary discussion of>
  - **Base Components Reused:** <File adapted/combined being components existing paths to>
- **Decisions & Rationale (Why & How):**
  - Why this specific layout or architecture was chosen.
  - Any deviations from standard Material 3 or standard app styling.
- **Touched Files:**
  - `<module/path/File.kt>`