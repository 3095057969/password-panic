import test from "node:test";
import assert from "node:assert/strict";

import { REFERENCE_SOLUTION } from "../js/rules.js";
import {
  MAX_PASSWORD_POINTS,
  RULESET_VERSION,
  STATE_SCHEMA_VERSION,
  createInitialState,
  normalizePassword,
  parseStoredState,
} from "../js/state.js";

const NOW = 1_800_000_000_000;
const CAPTCHA = "23456";
const SESSION = "session-test-0001";

function validV2(overrides = {}) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    sessionId: SESSION,
    password: "",
    activeCount: 1,
    captchaCode: CAPTCHA,
    captchaSolved: false,
    pressureSolved: false,
    knightSolved: false,
    startAt: null,
    finishMs: null,
    victory: false,
    savedAt: NOW,
    ...overrides,
  };
}

function parse(value, overrides = {}) {
  return parseStoredState(typeof value === "string" ? value : JSON.stringify(value), {
    now: NOW,
    captchaCode: CAPTCHA,
    sessionId: "fresh-session-0001",
    ...overrides,
  });
}

test("normalizePassword removes line breaks and truncates by Unicode code point", () => {
  assert.equal(normalizePassword("a\r\nb\nc"), "abc");

  const asciiThenEmoji = `${"a".repeat(MAX_PASSWORD_POINTS - 1)}🐱`;
  const emojiThenAscii = `${"🐱".repeat(MAX_PASSWORD_POINTS - 1)}a`;
  assert.equal(normalizePassword(asciiThenEmoji), asciiThenEmoji);
  assert.equal(normalizePassword(emojiThenAscii), emojiThenAscii);

  const overLimit = `${"🐱".repeat(MAX_PASSWORD_POINTS - 1)}😀a`;
  const normalized = normalizePassword(overLimit);
  assert.equal(Array.from(normalized).length, MAX_PASSWORD_POINTS);
  assert.equal(normalized.endsWith("😀"), true);
  assert.equal(normalized.includes("😀"), true);
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(normalized), false);
});

test("createInitialState emits the V2 schema and requested deterministic values", () => {
  const state = createInitialState({
    now: NOW,
    captchaCode: CAPTCHA,
    sessionId: SESSION,
  });
  assert.equal(state.schemaVersion, STATE_SCHEMA_VERSION);
  assert.equal(state.rulesetVersion, RULESET_VERSION);
  assert.equal(state.sessionId, SESSION);
  assert.equal(state.activeCount, 1);
  assert.equal(state.captchaCode, CAPTCHA);
  assert.equal(state.victory, false);
  assert.equal(state.startAt, null);
  assert.equal(state.finishMs, null);
});

test("valid v1 state migrates explicitly without dropping historical progress", () => {
  const result = parse({
    password: "Mango1!x",
    activeCount: 4,
    captchaCode: CAPTCHA,
    captchaSolved: false,
    pressureSolved: false,
    knightSolved: false,
    startAt: NOW - 5_000,
    finishMs: null,
    victory: false,
    savedAt: NOW - 1_000,
  });
  assert.equal(result.kind, "migrated");
  assert.equal(result.state.schemaVersion, STATE_SCHEMA_VERSION);
  assert.equal(result.state.rulesetVersion, RULESET_VERSION);
  assert.equal(result.state.activeCount, 4);
  assert.equal(result.state.password, "Mango1!x");
  assert.equal(result.state.sessionId, "fresh-session-0001");
});

test("strict V2 booleans, times, and captcha characters are normalized safely", () => {
  const result = parse(
    validV2({
      password: "",
      activeCount: 2,
      captchaCode: "abcde",
      captchaSolved: "false",
      pressureSolved: 1,
      knightSolved: {},
      startAt: -1,
      finishMs: -20,
      victory: true,
      savedAt: Number.NaN,
    }),
  );
  assert.equal(result.kind, "restored");
  assert.equal(result.state.captchaCode, CAPTCHA);
  assert.equal(result.state.captchaSolved, false);
  assert.equal(result.state.pressureSolved, false);
  assert.equal(result.state.knightSolved, false);
  assert.equal(result.state.startAt, null);
  assert.equal(result.state.finishMs, null);
  assert.equal(result.state.victory, false);
  assert.equal(result.state.savedAt, null);
});

test("corrupt JSON is reported with the original raw value", () => {
  const raw = "{broken";
  const result = parseStoredState(raw, { now: NOW, captchaCode: CAPTCHA, sessionId: SESSION });
  assert.equal(result.kind, "corrupt");
  assert.equal(result.raw, raw);
  assert.equal(result.state.schemaVersion, STATE_SCHEMA_VERSION);
});

test("a future schema is incompatible and never silently normalized as current", () => {
  const result = parse(validV2({ schemaVersion: STATE_SCHEMA_VERSION + 1 }));
  assert.equal(result.kind, "incompatible");
  assert.equal(result.state, null);
  assert.match(result.reason, /schema/i);
});

test("an unknown ruleset is incompatible", () => {
  const result = parse(validV2({ rulesetVersion: "future-ruleset" }));
  assert.equal(result.kind, "incompatible");
  assert.equal(result.state, null);
  assert.match(result.reason, /ruleset/i);
});

test("victory is recomputed from all 21 rules instead of trusting the saved flag", () => {
  const fake = parse(
    validV2({
      password: "",
      activeCount: 1,
      victory: true,
      finishMs: -10,
    }),
  );
  assert.equal(fake.state.victory, false);
  assert.equal(fake.state.finishMs, null);

  const legitimate = parse(
    validV2({
      password: REFERENCE_SOLUTION,
      activeCount: 21,
      captchaSolved: true,
      pressureSolved: true,
      knightSolved: true,
      startAt: NOW - 10_000,
      victory: false,
      finishMs: null,
    }),
  );
  assert.equal(legitimate.state.victory, true);
  assert.equal(legitimate.state.finishMs, 10_000);
});

test("restoration keeps the first 140 code points for both non-BMP boundary cases", () => {
  const emojiFirst = parse(
    validV2({ password: `${"🐱".repeat(MAX_PASSWORD_POINTS - 1)}a` }),
  ).state.password;
  assert.equal(Array.from(emojiFirst).length, MAX_PASSWORD_POINTS);
  assert.equal(emojiFirst.endsWith("a"), true);

  const asciiFirst = parse(
    validV2({ password: `${"a".repeat(MAX_PASSWORD_POINTS - 1)}🐱` }),
  ).state.password;
  assert.equal(Array.from(asciiFirst).length, MAX_PASSWORD_POINTS);
  assert.equal(asciiFirst.endsWith("🐱"), true);
});
