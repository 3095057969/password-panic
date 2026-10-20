import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
const PORT = 43173;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const STORAGE_KEY = "password-panic-state-v1";
const BACKUP_KEY = "password-panic-state-corrupt-backup";
const SESSION = "e2e-session-0001";
const CAPTCHA = "23456";
const INTERMEDIATE = "mangoIVAu喵🐱春c3🔥💀985xyzkxyzkxyzkxyzqwx!?";
const SOLUTION = "mangoIVAu喵🐱春c3🔥💀987654xyzkxyzkxyzkxyzqwx!?";

let server;
let browser;

function v2State(overrides = {}) {
  return {
    schemaVersion: 2,
    rulesetVersion: "1",
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
    savedAt: Date.now(),
    ...overrides,
  };
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // Server has not started yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("E2E server did not start");
}

async function openPage({
  raw = null,
  viewport = { width: 1280, height: 900 },
  reducedMotion = "no-preference",
  init = null,
} = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(
    ({ key, value }) => {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        // Storage failures are covered by their own scenario.
      }
    },
    { key: STORAGE_KEY, value: raw },
  );

  if (init) await page.addInitScript(init);
  await page.goto(BASE_URL, { waitUntil: "load" });
  await page.locator("#password").waitFor();
  return { context, page, pageErrors };
}

async function storedState(page) {
  await page.waitForFunction((key) => localStorage.getItem(key) !== null, STORAGE_KEY);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

async function captchaCodeFromPage(page) {
  const text = await page.locator("[data-captcha-accessible]").textContent();
  return text.replace("验证码为", "").replaceAll(" ", "").trim();
}

async function completeRealPath(page) {
  const password = page.locator("#password");
  await password.fill(INTERMEDIATE);
  const captcha = page.locator("[data-captcha-input]");
  await captcha.waitFor();
  const code = await captchaCodeFromPage(page);
  await captcha.fill(code.toLowerCase());
  await page.locator('[data-action="captcha-submit"]').click();

  await password.fill(SOLUTION);
  const valve = page.locator('[data-action="pressure-click"]');
  await valve.waitFor();
  for (let index = 0; index < 10; index += 1) await valve.click();

  const target = page.locator('[data-square="c3"]');
  await target.waitFor();
  await target.click();
  await page.locator("#victory:not([hidden])").waitFor({ timeout: 4_000 });
}

before(async () => {
  assert.equal(existsSync(EDGE), true, `Microsoft Edge not found at ${EDGE}`);
  server = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test("a real staged path completes all 21 rules at 320px", async () => {
  const { context, page, pageErrors } = await openPage({
    viewport: { width: 320, height: 820 },
  });

  await completeRealPath(page);
  assert.equal(await page.locator("#victory-chars").textContent(), "42");
  assert.match(await page.locator("#victory h2").textContent(), /你自由了/);
  assert.equal(await page.locator("#share-btn").isVisible(), true);
  assert.equal(await page.locator("#replay-btn").isVisible(), true);

  const geometry = await page.evaluate(() => {
    const card = document.querySelector(".victory-card").getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      left: card.left,
      right: card.right,
    };
  });
  assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.scrollWidth <= geometry.viewport + 1, JSON.stringify(geometry));
  console.log("[viewport] complete-path", JSON.stringify(geometry));
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("an untrusted fake victory is revoked and the input stays usable", async () => {
  const raw = JSON.stringify(
    v2State({
      victory: true,
      finishMs: -50,
      captchaSolved: "true",
      pressureSolved: 1,
      knightSolved: {},
    }),
  );
  const { context, page } = await openPage({ raw });

  await page.waitForTimeout(550);
  assert.equal(await page.locator("#victory").isHidden(), true);
  assert.equal(await page.locator("#password").isEnabled(), true);
  await page.locator("#password").fill("safe input");
  await page.waitForTimeout(220);

  const state = await storedState(page);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.victory, false);
  assert.equal(state.captchaSolved, false);
  assert.equal(state.pressureSolved, false);
  assert.equal(state.knightSolved, false);
  await context.close();
});

test("a v1 record migrates to v2 without collapsing historical unlocks", async () => {
  const raw = JSON.stringify({
    password: "mango",
    activeCount: 4,
    captchaCode: CAPTCHA,
    captchaSolved: false,
    pressureSolved: false,
    knightSolved: false,
    startAt: Date.now() - 5_000,
    finishMs: null,
    victory: false,
    savedAt: Date.now() - 1_000,
  });
  const { context, page } = await openPage({ raw });

  assert.equal(await page.locator("#header-rule-count").textContent(), "04");
  await page.waitForTimeout(260);
  const state = await storedState(page);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.rulesetVersion, "1");
  assert.equal(state.activeCount, 4);
  assert.equal(state.password, "mango");
  await context.close();
});

test("corrupt JSON is isolated behind a backup key and a new game starts", async () => {
  const raw = "{broken";
  const { context, page, pageErrors } = await openPage({ raw });

  await page.waitForTimeout(260);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), BACKUP_KEY), raw);
  assert.equal(await page.locator("#password").isEnabled(), true);
  const state = await storedState(page);
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("a future schema is preserved until the user explicitly starts fresh", async () => {
  const future = JSON.stringify({
    schemaVersion: 99,
    rulesetVersion: "future",
    password: "keep-this-version",
    activeCount: 12,
  });
  const { context, page } = await openPage({
    raw: future,
    viewport: { width: 320, height: 820 },
  });

  await page.waitForTimeout(350);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), future);
  const status = page.locator("#storage-status");
  assert.equal(await status.isVisible(), true);
  assert.match(await status.textContent(), /版本/);
  assert.equal(await page.locator("#start-fresh-btn").isVisible(), true);
  const geometry = await page.evaluate(() => {
    const button = document.querySelector("#start-fresh-btn").getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      left: button.left,
      right: button.right,
    };
  });
  assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.scrollWidth <= geometry.viewport + 1, JSON.stringify(geometry));
  console.log("[viewport] future-schema", JSON.stringify(geometry));

  await page.locator("#start-fresh-btn").click();
  await page.waitForTimeout(220);
  const state = await storedState(page);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.password, "");
  await context.close();
});

test("storage failure is persistent and clears after a successful save", async () => {
  const init = () => {
    window.__failGameStorage = true;
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === "password-panic-state-v1" && window.__failGameStorage) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return nativeSetItem.call(this, key, value);
    };
  };
  const { context, page } = await openPage({ init });

  await page.locator("#password").fill("Mango1!x");
  await page.waitForTimeout(260);
  const status = page.locator("#storage-status");
  assert.equal(await status.isVisible(), true);
  assert.match(await status.textContent(), /无法保存/);

  await page.evaluate(() => {
    window.__failGameStorage = false;
  });
  await page.locator("#password").fill("Mango1!x9");
  await page.waitForTimeout(260);
  assert.equal((await status.textContent()).includes("无法保存"), false);
  await context.close();
});

test("IME composition Enter is not intercepted or blurred", async () => {
  const { context, page } = await openPage();
  const result = await page.locator("#password").evaluate((textarea) => {
    textarea.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    const dispatchResult = textarea.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      dispatchResult,
      stillFocused: document.activeElement === textarea,
    };
  });

  assert.deepEqual(result, { defaultPrevented: false, dispatchResult: true, stillFocused: true });
  await context.close();
});

test("input truncates at 140 Unicode code points without splitting emoji", async () => {
  const { context, page } = await openPage();
  const overLimit = `${"🐱".repeat(139)}ab`;
  await page.locator("#password").evaluate((textarea, value) => {
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, overLimit);

  const result = await page.locator("#password").evaluate((textarea) => ({
    value: textarea.value,
    codePoints: Array.from(textarea.value).length,
    hasLoneSurrogate: /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(textarea.value),
  }));
  assert.equal(result.codePoints, 140);
  assert.equal(result.value.endsWith("a"), true);
  assert.equal(result.hasLoneSurrogate, false);
  assert.equal(await page.locator("#char-count").textContent(), "140");
  assert.equal(await page.locator("#char-limit").textContent(), "140");
  await context.close();
});

test("a delayed victory from the previous session cannot cross a reset", async () => {
  const raw = JSON.stringify(
    v2State({
      password: SOLUTION.slice(0, -1),
      activeCount: 20,
      captchaSolved: true,
      pressureSolved: true,
      knightSolved: true,
      startAt: Date.now() - 5_000,
    }),
  );
  const { context, page } = await openPage({ raw });

  await page.locator("#password").fill(SOLUTION);
  await page.evaluate(() => {
    const reset = document.querySelector("#reset-btn");
    reset.click();
    reset.click();
  });
  await page.waitForTimeout(700);

  assert.equal(await page.locator("#victory").isHidden(), true);
  assert.equal(await page.locator("#password").isEnabled(), true);
  assert.equal(await page.locator("#password").inputValue(), "");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  await context.close();
});

test("reduced motion suppresses CAPTCHA shake and confetti", async () => {
  const init = () => {
    window.__animateCalls = 0;
    const nativeAnimate = Element.prototype.animate;
    Element.prototype.animate = function animate(...args) {
      window.__animateCalls += 1;
      return nativeAnimate.apply(this, args);
    };
  };
  const raw = JSON.stringify(v2State({ password: INTERMEDIATE, activeCount: 9 }));
  const { context, page } = await openPage({ raw, reducedMotion: "reduce", init });

  await page.locator("[data-captcha-input]").fill("XXXXX");
  await page.locator('[data-action="captcha-submit"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__animateCalls), 0);
  assert.equal(await page.locator(".confetti i").count(), 0);
  await context.close();
});

test("CAPTCHA copy matches case-insensitive behavior and accepts lowercase", async () => {
  const raw = JSON.stringify(v2State({ password: INTERMEDIATE, activeCount: 9 }));
  const { context, page } = await openPage({ raw });
  const challenge = page.locator(".captcha-challenge");
  assert.match(await challenge.textContent(), /不区分大小写/);

  const code = await captchaCodeFromPage(page);
  await page.locator("[data-captcha-input]").fill(code.toLowerCase());
  await page.locator('[data-action="captcha-submit"]').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".captcha-challenge.is-solved").count(), 1);
  await context.close();
});

test("a regression notice outranks a simultaneous newly-passed rule", async () => {
  const initial = "mangoIVAu9!7x9🐱喵abcdefghijk";
  const raw = JSON.stringify(
    v2State({
      password: initial,
      activeCount: 12,
      captchaSolved: true,
    }),
  );
  const { context, page } = await openPage({ raw });
  const password = page.locator("#password");

  await password.fill(initial.replace("喵", ""));
  await password.fill(initial.replace("!", "").replace("🐱", "🐱喵"));
  const notice = page.locator("#notice");
  assert.match(await notice.textContent(), /第 03 条失效/);
  assert.match(await notice.getAttribute("class"), /is-alert/);
  await context.close();
});

test("Escape closes the victory dialog, restores focus, and allows reopening", async () => {
  const raw = JSON.stringify(
    v2State({
      password: SOLUTION,
      activeCount: 21,
      captchaSolved: true,
      pressureSolved: true,
      knightSolved: true,
      startAt: Date.now() - 10_000,
      finishMs: 10_000,
      victory: true,
    }),
  );
  const { context, page } = await openPage({ raw });

  await page.locator("#victory:not([hidden])").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#victory").isHidden(), true);
  const reopen = page.locator("#show-victory-btn");
  assert.equal(await reopen.isVisible(), true);
  assert.equal(await reopen.evaluate((button) => document.activeElement === button), true);

  await reopen.click();
  await page.locator("#victory:not([hidden])").waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), true);
  await context.close();
});

test("clipboard failure is visible and does not clear victory", async () => {
  const raw = JSON.stringify(
    v2State({
      password: SOLUTION,
      activeCount: 21,
      captchaSolved: true,
      pressureSolved: true,
      knightSolved: true,
      startAt: Date.now() - 10_000,
      finishMs: 10_000,
      victory: true,
    }),
  );
  const { context, page } = await openPage({ raw });
  await page.locator("#victory:not([hidden])").waitFor();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("denied"); } },
    });
    document.execCommand = () => false;
  });
  await page.locator("#share-btn").click();
  await page.waitForTimeout(80);
  assert.match(await page.locator("#toast").textContent(), /复制失败/);
  assert.equal(await page.locator("#victory").isVisible(), true);
  await context.close();
});

test("share report contains no game input, CAPTCHA, or internal state", async () => {
  const raw = JSON.stringify(
    v2State({
      password: SOLUTION,
      activeCount: 21,
      captchaSolved: true,
      pressureSolved: true,
      knightSolved: true,
      startAt: Date.now() - 10_000,
      finishMs: 10_000,
      victory: true,
    }),
  );
  const { context, page } = await openPage({ raw });
  await page.locator("#victory:not([hidden])").waitFor();
  await page.evaluate(() => {
    window.__copiedReport = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { window.__copiedReport = value; } },
    });
  });
  await page.locator("#share-btn").click();
  await page.waitForTimeout(80);
  const report = await page.evaluate(() => window.__copiedReport);
  assert.match(report, /21 条规则/);
  assert.match(report, /42 个字符/);
  assert.equal(report.includes(SOLUTION), false);
  assert.equal(report.includes(CAPTCHA), false);
  assert.equal(report.includes("schemaVersion"), false);
  await context.close();
});

test("core accessibility semantics and live regions are present", async () => {
  const { context, page } = await openPage();
  assert.equal(await page.locator('[role="dialog"]').getAttribute("aria-modal"), "true");
  assert.equal(await page.locator("#progress-segments").getAttribute("role"), "progressbar");
  assert.equal(await page.locator("#notice").getAttribute("aria-live"), "polite");
  assert.equal(await page.locator("#storage-status").getAttribute("aria-live"), "polite");
  assert.ok(await page.locator('label[for="password"]').count());
  const unnamed = await page.locator("button").evaluateAll((buttons) =>
    buttons.filter((button) => !(button.getAttribute("aria-label") || button.textContent.trim())).length,
  );
  assert.equal(unnamed, 0);
  await context.close();
});

test("200 input samples stay responsive", async () => {
  const { context, page } = await openPage();
  const durations = await page.locator("#password").evaluate((textarea) => {
    const samples = [];
    for (let index = 0; index < 200; index += 1) {
      const value = `mangoIVAu喵🐱春c3🔥💀${String(index).padStart(3, "0")}xyzkxyzkxyz`;
      const started = performance.now();
      textarea.value = value;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      samples.push(performance.now() - started);
    }
    return samples;
  });
  const sorted = [...durations].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  const p50 = percentile(0.5);
  const p95 = percentile(0.95);
  console.log(`[performance] 200 synchronous input handlers: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
  assert.ok(p95 < 100, `p95 exceeded 100ms: ${p95}`);
  await context.close();
});
