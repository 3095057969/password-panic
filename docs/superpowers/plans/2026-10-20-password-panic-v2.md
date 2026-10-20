# Password Panic V2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the P0/P1/P2 stability requirements in PRD V2.0 without changing the 21-rule game design, then prove the result with unit, storage-contract, browser E2E, performance, and accessibility checks.

**Architecture:** Extract persistence, migration, Unicode normalization, and victory reconciliation into a pure `js/state.js` module. Keep DOM orchestration in `js/game.js`, add session-scoped async helpers and a persistent storage banner. Use Node's test runner for pure tests and `playwright-core` with installed Microsoft Edge for browser tests.

**Tech Stack:** Vanilla HTML/CSS/ES modules, Node 18+ test runner, Playwright Core, Microsoft Edge 155.

**Spec:** `PRD_V2.0.md`

## Global Constraints

- Keep the 21 rule IDs, order, retirement relationship, and reference solution unchanged.
- Persist only local joke-game state; never upload game input or include it in reports.
- All password limits and rule checks use Unicode code points, maximum 140.
- Boolean persisted fields accept only JSON booleans.
- Unknown future schema values must never be overwritten automatically.
- Old asynchronous callbacks must not mutate a restarted session.
- Preserve the user's existing asset reorganization and PRD files.

## Review Focus

- Malformed storage must not create a locked fake victory or crash startup.
- A callback scheduled by the previous session must do nothing after reset.
- IME composition Enter must not be intercepted.
- A 140-code-point input containing non-BMP emoji must not split a surrogate pair.
- Storage failure must remain visible and recover when writing succeeds.

---

### Task 1: Pure state and input contract

**Files:**
- Create: `js/state.js`
- Create: `tests/state.test.mjs`

**Interfaces:**
- Produces: `STATE_SCHEMA_VERSION`, `RULESET_VERSION`, `MAX_PASSWORD_POINTS`, `normalizePassword`, `createInitialState`, `parseStoredState`.
- `parseStoredState(raw, options)` returns `{ kind, state, reason?, raw? }`, where `kind` is `fresh`, `migrated`, `restored`, `corrupt`, or `incompatible`.

- [ ] Write tests for code-point truncation, v1 migration, strict schema validation, fake-victory reconciliation, corrupt JSON, and future-version protection.
- [ ] Run `node --test tests/state.test.mjs`; expected: module-not-found failure.
- [ ] Implement `js/state.js` with strict typed normalization and victory recomputation.
- [ ] Re-run the test; expected: all pure state tests pass.
- [ ] Run `npm test`; expected: existing rule tests and new state tests pass.

### Task 2: Browser state machine integration

**Files:**
- Modify: `index.html`
- Modify: `js/game.js`
- Modify: `js/rules.js`
- Modify: `assets/css/styles.css`
- Create: `tests/e2e.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 state helpers.
- Produces: storage banner, result reopen control, session-scoped timers, IME-safe Enter, 140-code-point input enforcement.

- [ ] Write browser tests for real unlocking, fake victory, reset race, IME Enter, Unicode boundaries, save failure recovery, unknown schema, regression notice, reduced motion, Escape/reopen, and 320px controls.
- [ ] Run `node --test --test-concurrency=1 tests/e2e.test.mjs`; expected: failures for missing V2 behavior.
- [ ] Integrate state migration and persistence safeguards into `js/game.js`.
- [ ] Add session/generation guards for delayed callbacks and reset cleanup.
- [ ] Fix IME and code-point truncation behavior.
- [ ] Add persistent save/version banners and result reopening.
- [ ] Fix CAPTCHA copy, regression notice priority, and reduced-motion WAAPI behavior.
- [ ] Re-run the E2E suite; expected: all scenarios pass in Microsoft Edge.

### Task 3: Verification and report

**Files:**
- Create: `docs/reviews/password-panic-v2-test-report-2026-10-20.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: test results and implementation evidence.
- Produces: a release-oriented report mapping requirements and acceptance scenarios to evidence and limitations.

- [ ] Run `npm test` and capture exact pass counts.
- [ ] Run the complete Edge E2E suite and capture environment/version.
- [ ] Run the 200-sample performance measurement and capture p50/p95.
- [ ] Inspect the 320px layout and accessibility semantics.
- [ ] Write the detailed test report with requirement coverage, defects found, residual risks, and environment limits.
- [ ] Update README testing and persistence language.
- [ ] Run final verification commands and inspect `git diff` without reverting unrelated work.
