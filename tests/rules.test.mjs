import test from "node:test";
import assert from "node:assert/strict";

import {
  REFERENCE_SOLUTION,
  RULES,
  TOTAL_RULES,
  activeRuleIds,
  charsOf,
  digitSum,
  hasTriple,
  makeContext,
  resolveRule,
} from "../js/rules.js";

function statusesFor(password, activeCount = TOTAL_RULES, flags = {}) {
  const context = makeContext(password, {
    captchaSolved: true,
    pressureSolved: true,
    knightSolved: true,
    ...flags,
  });
  const ids = activeRuleIds(activeCount);
  return RULES.slice(0, activeCount).map((rule) => ({
    id: rule.id,
    ...resolveRule(rule, context, ids),
  }));
}

test("the rule table is complete and has unique ids and codes", () => {
  assert.equal(RULES.length, TOTAL_RULES);
  assert.equal(new Set(RULES.map((rule) => rule.id)).size, TOTAL_RULES);
  assert.deepEqual(
    RULES.map((rule) => rule.code),
    Array.from({ length: TOTAL_RULES }, (_, index) => String(index + 1).padStart(2, "0")),
  );
});

test("pure helpers count unicode characters correctly", () => {
  assert.equal(charsOf("a🐱🔥").length, 3);
  assert.equal(charsOf("🐱").length, 1);
  assert.equal(digitSum("9a8b7"), 24);
  assert.equal(hasTriple("aaab"), true);
  assert.equal(hasTriple("a🐱🐱🐱"), true);
  assert.equal(hasTriple("aabb"), false);
});

test("the reference solution completes every rule", () => {
  assert.equal(charsOf(REFERENCE_SOLUTION).length, 42);
  const statuses = statusesFor(REFERENCE_SOLUTION);
  const failed = statuses.filter((status) => !status.passed);
  assert.deepEqual(failed, []);
});

test("rule 04 retires once the amendment is active", () => {
  const noAmendment = makeContext(REFERENCE_SOLUTION, {
    captchaSolved: true,
    pressureSolved: true,
    knightSolved: true,
  });
  const activeWithoutAmendment = activeRuleIds(12);
  const oldRule = RULES.find((rule) => rule.id === "digit-sum-25");
  assert.equal(resolveRule(oldRule, noAmendment, activeWithoutAmendment).passed, false);

  const withAmendment = activeRuleIds(13);
  assert.deepEqual(resolveRule(oldRule, noAmendment, withAmendment), { passed: true, retired: true });
});

test("the checklist is strict about exact content", () => {
  const password = "mangoIVAu喵🐱春c3🔥💀9876543xyzk!?";
  const passes = (id) => {
    const rule = RULES.find((candidate) => candidate.id === id);
    return Boolean(rule.test(makeContext(password, { captchaSolved: true, pressureSolved: true, knightSolved: true })));
  };

  assert.equal(passes("length-8"), true);
  assert.equal(passes("mixed-case"), true);
  assert.equal(passes("symbol"), true);
  assert.equal(passes("animal"), true);
  assert.equal(passes("mango"), true);
  assert.equal(passes("roman"), true);
  assert.equal(passes("gold"), true);
  assert.equal(passes("cat"), true);
  assert.equal(passes("no-e"), true);
  assert.equal(passes("no-triple"), true);
  assert.equal(passes("season"), true);
  assert.equal(passes("fire-skull"), true);
  assert.equal(passes("ending"), true);
  assert.equal(passes("blacklist"), true);
});

test("specific checks reject the obvious shortcuts", () => {
  const checks = [
    ["length-8", "short", false],
    ["mixed-case", "lowercase1", false],
    ["mixed-case", "UPPER1", false],
    ["symbol", "NoSymbol1", false],
    ["digit-sum-25", "Mango9!aaaa", false],
    ["animal", "no animals here", false],
    ["mango", "Mango1!", false],
    ["roman", "iv", false],
    ["gold", "AU", false],
    ["no-e", "Mango!E", true],
    ["no-e", "Mango!e", false],
    ["no-triple", "aaabbb", false],
    ["season", "spring", false],
    ["fire-skull", "💀abc🔥", false],
    ["ending", "end? ", false],
    ["blacklist", "superADMIN", false],
    ["blacklist", "ROOT", false],
    ["blacklist", "xx123xx", false],
    ["exact-42", "a".repeat(41), false],
    ["exact-42", "a".repeat(42), true],
  ];

  for (const [id, password, expected] of checks) {
    const rule = RULES.find((candidate) => candidate.id === id);
    const actual = Boolean(
      rule.test(makeContext(password, { captchaSolved: true, pressureSolved: true, knightSolved: true })),
    );
    assert.equal(actual, expected, `${id} should be ${expected ? "satisfied" : "unsatisfied"} by ${JSON.stringify(password)}`);
  }
});

test("interactive rules require both the action and the password content", () => {
  const knight = RULES.find((rule) => rule.id === "knight");
  const base = { captchaSolved: true, pressureSolved: true };
  assert.equal(Boolean(knight.test(makeContext("C3", { ...base, knightSolved: false }))), false);
  assert.equal(Boolean(knight.test(makeContext("no coordinate", { ...base, knightSolved: true }))), false);
  assert.equal(Boolean(knight.test(makeContext("c3", { ...base, knightSolved: true }))), true);

  const captcha = RULES.find((rule) => rule.id === "captcha");
  assert.equal(Boolean(captcha.test(makeContext("anything", { captchaSolved: false }))), false);
  assert.equal(Boolean(captcha.test(makeContext("anything", { captchaSolved: true }))), true);
});

test("the solution is 42 unicode characters", () => {
  assert.equal(Array.from(REFERENCE_SOLUTION).length, 42);
  assert.equal(REFERENCE_SOLUTION.endsWith("?"), true);
});
