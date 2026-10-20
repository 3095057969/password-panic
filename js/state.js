/**
 * PASSWORD PANIC — persistence and Unicode input contracts.
 * Pure functions only so migration and victory invariants are testable.
 */

import {
  RULES,
  TOTAL_RULES,
  activeRuleIds,
  makeContext,
  resolveRule,
} from "./rules.js";

export const STATE_SCHEMA_VERSION = 2;
export const RULESET_VERSION = "1";
export const MAX_PASSWORD_POINTS = 140;

const CAPTCHA_ALPHABET = "23456789ACDEFGHJKMNPQRTUVWXY";
const CAPTCHA_LENGTH = 5;
const DEFAULT_ACTIVE_COUNT = 1;
const DEFAULT_SESSION_ID = "local-session";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoolean(value) {
  return value === true || value === false;
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function clampActiveCount(value) {
  if (!Number.isSafeInteger(value)) return DEFAULT_ACTIVE_COUNT;
  return Math.min(TOTAL_RULES, Math.max(1, value));
}

function normalizeSessionId(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeCaptchaCode(value, fallback) {
  if (typeof value !== "string") return fallback;
  const code = value.toUpperCase();
  if (code.length !== CAPTCHA_LENGTH) return fallback;
  return Array.from(code).every((char) => CAPTCHA_ALPHABET.includes(char)) ? code : fallback;
}

function normalizeSavedAt(value) {
  return isNonNegativeInteger(value) ? value : null;
}

function normalizeTime(value) {
  return isNonNegativeInteger(value) ? value : null;
}

/**
 * Keep complete Unicode code points. Removing lone surrogates prevents
 * storage from preserving strings that cannot be displayed safely.
 */
export function normalizePassword(value) {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/[\r\n]/g, ""))
    .filter((char) => !/^[\uD800-\uDFFF]$/.test(char))
    .slice(0, MAX_PASSWORD_POINTS)
    .join("");
}

export function createInitialState({ now = Date.now(), captchaCode, sessionId } = {}) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    sessionId: normalizeSessionId(sessionId, DEFAULT_SESSION_ID),
    password: "",
    activeCount: DEFAULT_ACTIVE_COUNT,
    captchaCode: normalizeCaptchaCode(captchaCode, "23456"),
    captchaSolved: false,
    pressureSolved: false,
    knightSolved: false,
    startAt: null,
    finishMs: null,
    victory: false,
    savedAt: isNonNegativeInteger(now) ? now : null,
  };
}

function evaluateVictory(candidate) {
  const password = candidate.password;
  const activeCount = candidate.activeCount;
  if (activeCount !== TOTAL_RULES) return false;

  const ids = activeRuleIds(activeCount);
  const context = makeContext(password, candidate);
  return RULES.slice(0, activeCount).every((rule) => resolveRule(rule, context, ids).passed);
}

function makeStateFromCandidate(candidate, { now, sessionId, finishMs }) {
  const legitimateVictory = evaluateVictory(candidate);
  const victory = legitimateVictory;
  const startAt = normalizeTime(candidate.startAt);
  let resolvedFinishMs = null;

  if (legitimateVictory) {
    resolvedFinishMs = normalizeTime(finishMs);
    if (resolvedFinishMs === null && startAt !== null) {
      resolvedFinishMs = Math.max(0, now - startAt);
    }
  }

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    sessionId: normalizeSessionId(candidate.sessionId, sessionId),
    password: normalizePassword(candidate.password),
    activeCount: clampActiveCount(candidate.activeCount),
    captchaCode: normalizeCaptchaCode(candidate.captchaCode, "23456"),
    captchaSolved: isBoolean(candidate.captchaSolved) ? candidate.captchaSolved : false,
    pressureSolved: isBoolean(candidate.pressureSolved) ? candidate.pressureSolved : false,
    knightSolved: isBoolean(candidate.knightSolved) ? candidate.knightSolved : false,
    startAt,
    finishMs: resolvedFinishMs,
    victory,
    savedAt: normalizeSavedAt(candidate.savedAt),
  };
}

export function parseStoredState(raw, { now = Date.now(), captchaCode, sessionId } = {}) {
  const fallback = createInitialState({ now, captchaCode, sessionId });
  if (raw === null || raw === undefined || raw === "") {
    return { kind: "fresh", state: fallback };
  }

  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { kind: "corrupt", state: fallback, raw };
  }

  if (!isRecord(parsed)) {
    return { kind: "corrupt", state: fallback, raw };
  }

  if (Object.hasOwn(parsed, "schemaVersion")) {
    if (!Number.isSafeInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) {
      return { kind: "corrupt", state: fallback, raw };
    }
    if (parsed.schemaVersion > STATE_SCHEMA_VERSION) {
      return {
        kind: "incompatible",
        state: null,
        reason: `Unsupported schemaVersion: ${parsed.schemaVersion}`,
        raw,
      };
    }
  }

  if (
    Object.hasOwn(parsed, "rulesetVersion") &&
    parsed.rulesetVersion !== RULESET_VERSION
  ) {
    return {
      kind: "incompatible",
      state: null,
      reason: `Unsupported rulesetVersion: ${String(parsed.rulesetVersion)}`,
      raw,
    };
  }

  const state = makeStateFromCandidate(parsed, {
    now: isNonNegativeInteger(now) ? now : Date.now(),
    sessionId: normalizeSessionId(sessionId, DEFAULT_SESSION_ID),
    finishMs: parsed.finishMs,
  });
  const kind = Object.hasOwn(parsed, "schemaVersion") ? "restored" : "migrated";
  return { kind, state };
}
