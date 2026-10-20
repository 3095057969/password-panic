/**
 * PASSWORD PANIC — game controller.
 * No framework, no tracking, no real passwords.
 */

import {
  RULES,
  TOTAL_RULES,
  activeRuleIds,
  charsOf,
  digitSum,
  makeContext,
  resolveRule,
} from "./rules.js";
import {
  MAX_PASSWORD_POINTS,
  createInitialState,
  normalizePassword,
  parseStoredState,
} from "./state.js";

const STORAGE_KEY = "password-panic-state-v1";
const SOUND_KEY = "password-panic-sound";
const CORRUPT_BACKUP_KEY = "password-panic-state-corrupt-backup";
const CAPTCHA_ALPHABET = "23456789ACDEFGHJKMNPQRTUVWXY";
const CAPTCHA_LENGTH = 5;
const PRESSURE_CLICKS = 10;
const PRESSURE_TIMEOUT = 1150;
const KNIGHT_COORDS = ["a", "b", "c", "d", "e"];
const KNIGHT_RANKS = [5, 4, 3, 2, 1];

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const loadResult = loadState();
let state = loadResult.state;
let loadKind = loadResult.kind;
let storageWritable = !loadResult.storageUnavailable && loadKind !== "incompatible";
let storageFailureShown = false;
let storageStatusTimer = null;
let soundOn = loadSoundPreference();
let audioContext = null;
let renderedCount = 0;
let lastResolvedIds = new Set();
let lastCurrentId = null;
let hintOpen = false;
let resetArmed = false;
let resetTimer = null;
let pressureTimer = null;
let pressureClicks = 0;
let saveTimer = null;
let toastTimer = null;
let victoryShown = false;
let clockTimer = null;
let sessionGeneration = 0;
let passwordComposing = false;
let victoryReturnFocus = null;

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheElements();
  els.charLimit.textContent = String(MAX_PASSWORD_POINTS);
  buildProgressSegments();
  bindEvents();
  syncSoundButton();
  els.password.value = state.password;
  syncUI({ initial: true });
  startClock();
  syncLoadStatus();

  if (loadKind === "migrated" || loadKind === "corrupt") scheduleSave();
  if (loadKind === "incompatible") showIncompatibleState();

  if (state.victory) {
    const generation = sessionGeneration;
    window.setTimeout(() => {
      if (generation === sessionGeneration && state.victory) {
        showVictory({ silent: true, expectedGeneration: generation });
      }
    }, 240);
  }
}

function cacheElements() {
  els.password = document.querySelector("#password");
  els.charCount = document.querySelector("#char-count");
  els.charLimit = document.querySelector("#char-limit");
  els.digitSum = document.querySelector("#digit-sum");
  els.progressSegments = document.querySelector("#progress-segments");
  els.resolvedLabel = document.querySelector("#resolved-label");
  els.pressureLabel = document.querySelector("#pressure-label");
  els.headerRuleCount = document.querySelector("#header-rule-count");
  els.globalScore = document.querySelector("#score-num");
  els.gauge = document.querySelector("#hero-gauge");
  els.gaugeValue = document.querySelector("#gauge-value");
  els.heroRules = document.querySelector("#hero-rules");
  els.heroReview = document.querySelector("#hero-review");
  els.threatLevel = document.querySelector("#threat-level");
  els.systemState = document.querySelector("#system-state-label");
  els.sessionTime = document.querySelector("#session-time");
  els.rulesList = document.querySelector("#rules-list");
  els.lockedTeaser = document.querySelector("#locked-teaser");
  els.teaserCount = document.querySelector("#teaser-count");
  els.currentObjective = document.querySelector("#current-objective");
  els.currentHint = document.querySelector("#current-hint");
  els.notice = document.querySelector("#notice");
  els.storageStatus = document.querySelector("#storage-status");
  els.startFreshBtn = document.querySelector("#start-fresh-btn");
  els.showVictoryBtn = document.querySelector("#show-victory-btn");
  els.inputState = document.querySelector("#input-state");
  els.consoleAudit = document.querySelector("#console-audit");
  els.consoleHint = document.querySelector("#console-hint");
  els.consoleStatus = document.querySelector("#console-status");
  els.hintBtn = document.querySelector("#hint-btn");
  els.copyBtn = document.querySelector("#copy-btn");
  els.resetBtn = document.querySelector("#reset-btn");
  els.soundToggle = document.querySelector("#sound-toggle");
  els.soundLabel = document.querySelector("#sound-label");
  els.startLink = document.querySelector("#start-link");
  els.victory = document.querySelector("#victory");
  els.victoryChars = document.querySelector("#victory-chars");
  els.victoryTime = document.querySelector("#victory-time");
  els.victoryPassword = document.querySelector("#victory-password");
  els.shareBtn = document.querySelector("#share-btn");
  els.replayBtn = document.querySelector("#replay-btn");
  els.confetti = document.querySelector("#confetti");
  els.toast = document.querySelector("#toast");
}

function buildProgressSegments() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < TOTAL_RULES; index += 1) {
    const segment = document.createElement("span");
    segment.setAttribute("aria-hidden", "true");
    fragment.append(segment);
  }
  els.progressSegments.append(fragment);
}

function bindEvents() {
  els.password.addEventListener("input", handlePasswordInput);
  els.password.addEventListener("compositionstart", () => {
    passwordComposing = true;
  });
  els.password.addEventListener("compositionend", () => {
    passwordComposing = false;
    handlePasswordInput();
  });
  els.password.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      els.password.blur();
    }
  });

  els.hintBtn.addEventListener("click", toggleHint);
  els.copyBtn.addEventListener("click", copyPassword);
  els.resetBtn.addEventListener("click", handleResetClick);
  els.soundToggle.addEventListener("click", toggleSound);
  els.shareBtn.addEventListener("click", shareReport);
  els.replayBtn.addEventListener("click", () => newGame({ focus: true }));
  els.showVictoryBtn.addEventListener("click", () => showVictory({ silent: true }));
  els.startFreshBtn.addEventListener("click", () => {
    newGame({ focus: true, allowOverwrite: true });
  });

  els.startLink.addEventListener("click", (event) => {
    event.preventDefault();
    document.querySelector("#game").scrollIntoView({
      behavior: reduceMotion.matches ? "auto" : "smooth",
      block: "start",
    });
    if (window.matchMedia("(min-width: 901px)").matches) {
      const generation = sessionGeneration;
      window.setTimeout(() => {
        if (generation === sessionGeneration) els.password.focus({ preventScroll: true });
      }, 520);
    }
  });

  els.rulesList.addEventListener("click", handleRuleListClick);
  els.rulesList.addEventListener("keydown", handleRuleListKeydown);

  document.addEventListener("keydown", handleDocumentKeydown);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveState();
  });
  window.addEventListener("beforeunload", saveState);
}

/* ============================== State ============================== */

function createCaptcha() {
  let code = "";
  const bytes = new Uint32Array(CAPTCHA_LENGTH);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    code = Array.from(bytes, (value) => CAPTCHA_ALPHABET[value % CAPTCHA_ALPHABET.length]).join("");
  } else {
    for (let index = 0; index < CAPTCHA_LENGTH; index += 1) {
      code += CAPTCHA_ALPHABET[Math.floor(Math.random() * CAPTCHA_ALPHABET.length)];
    }
  }
  return code;
}

function createSessionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function initialState() {
  return createInitialState({
    captchaCode: createCaptcha(),
    sessionId: createSessionId(),
  });
}

function loadState() {
  const fresh = initialState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const result = parseStoredState(raw, {
      captchaCode: fresh.captchaCode,
      sessionId: fresh.sessionId,
    });

    if (result.kind === "corrupt") {
      try {
        window.localStorage.setItem(CORRUPT_BACKUP_KEY, result.raw);
      } catch {
        // The backup is diagnostic only; the game must still open.
      }
    }

    if (result.kind === "incompatible") {
      return { ...result, state: fresh };
    }

    return result;
  } catch {
    return { kind: "fresh", state: fresh, storageUnavailable: true };
  }
}

function saveState() {
  window.clearTimeout(saveTimer);
  saveTimer = null;

  if (!storageWritable) return false;

  try {
    state.savedAt = Date.now();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    reportStorageSuccess();
    return true;
  } catch {
    reportStorageFailure();
    return false;
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveState, 120);
}

function setStorageStatus(message, tone = "", persist = false) {
  if (!els.storageStatus) return;
  window.clearTimeout(storageStatusTimer);
  storageStatusTimer = null;
  els.storageStatus.textContent = message;
  els.storageStatus.dataset.tone = tone;
  els.storageStatus.hidden = false;

  if (!persist) {
    storageStatusTimer = window.setTimeout(() => {
      els.storageStatus.hidden = true;
    }, 2200);
  }
}

function reportStorageFailure() {
  storageFailureShown = true;
  setStorageStatus("本次进度无法保存，刷新会丢失。", "alert", true);
}

function reportStorageSuccess() {
  if (!storageFailureShown) return;
  storageFailureShown = false;
  setStorageStatus("存档已恢复，最新进度已保存。", "good");
}

function syncLoadStatus() {
  if (!els.storageStatus) return;

  if (loadResult.storageUnavailable) {
    reportStorageFailure();
  } else if (loadKind === "corrupt") {
    setStorageStatus("检测到损坏存档，原值已备份，并已开始新局。", "alert", true);
  } else if (loadKind === "migrated") {
    setStorageStatus("旧版存档已升级，正在保存当前版本。", "good");
  } else if (loadKind === "restored") {
    setStorageStatus("已恢复上次进度。", "good", false);
  }
}

function showIncompatibleState() {
  if (!els.storageStatus || !els.startFreshBtn) return;
  setStorageStatus(
    "检测到更高版本的存档。为避免覆盖，当前页面不会自动保存；请使用当前版本开始新局。",
    "alert",
    true,
  );
  els.startFreshBtn.hidden = false;
}

function loadSoundPreference() {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveSoundPreference() {
  try {
    window.localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off");
  } catch {
    /* no-op */
  }
}

/* ============================== Game evaluation ============================== */

function getStatuses() {
  const context = makeContext(state.password, state);
  const ids = activeRuleIds(state.activeCount);
  return RULES.slice(0, state.activeCount).map((rule) => ({
    rule,
    ...resolveRule(rule, context, ids),
  }));
}

function syncUI({ initial = false } = {}) {
  const previousActive = state.activeCount;
  const previousResolvedIds = new Set(lastResolvedIds);
  const previousCurrentId = lastCurrentId;
  const beforeRendered = renderedCount;

  // Reveal every rule that is already satisfied. Satisfying one rule can
  // immediately reveal another that the player happened to satisfy already.
  let statuses = getStatuses();
  let unlockedAny = false;
  while (state.activeCount < TOTAL_RULES && statuses.every((status) => status.passed)) {
    state.activeCount += 1;
    unlockedAny = true;
    statuses = getStatuses();
  }

  const context = makeContext(state.password, state);
  const resolvedCount = statuses.filter((status) => status.passed).length;
  const current = statuses.find((status) => !status.passed) ?? null;
  const allResolved = statuses.length === TOTAL_RULES && resolvedCount === TOTAL_RULES;
  const justWon = allResolved && !state.victory;

  if (justWon) {
    state.victory = true;
    state.finishMs = Math.max(0, Date.now() - (state.startAt ?? Date.now()));
    if (state.startAt === null) state.startAt = Date.now() - state.finishMs;
  }

  renderNewCards({ initial, animate: !initial });
  updateCards(statuses, current);
  updateProgress({ statuses, resolvedCount, current });
  updateStatusPanels({ statuses, resolvedCount, current, allResolved });
  updateObjective({ current, allResolved });
  updateHero({ resolvedCount });
  updateInputMeta(context);
  updateCurrentHint({ current, previousCurrentId });

  const resolvedIds = new Set(statuses.filter((status) => status.passed).map((status) => status.rule.id));
  const newlyResolved = statuses.filter(
    (status) => status.passed && !previousResolvedIds.has(status.rule.id),
  );
  const regressed = statuses.filter(
    (status) => !status.passed && previousResolvedIds.has(status.rule.id),
  );

  if (!initial && !state.victory) {
    if (state.activeCount > previousActive) {
      const newRule = RULES[state.activeCount - 1];
      setNotice(`新规则已加载：第 ${newRule.code} 条《${newRule.title}》。`, "alert");
    } else if (regressed.length > 0) {
      const latest = regressed[regressed.length - 1].rule;
      setNotice(`第 ${latest.code} 条失效。需要回头修改密码。`, "alert");
    } else if (newlyResolved.length > 0) {
      const latest = newlyResolved[newlyResolved.length - 1].rule;
      setNotice(`第 ${latest.code} 条《${latest.title}》已通过。`, "good");
    }
  }

  if (initial) {
    if (state.password) {
      setNotice(state.victory ? "审查结束：全部规则通过。" : "上一场审查已恢复。继续。");
    } else {
      setNotice("输入第一个字符，开始审查。");
    }
  }

  if (!initial && unlockedAny && !state.victory) playSound("unlock");
  else if (!initial && newlyResolved.length > 0 && !state.victory) playSound("pass");

  if (state.activeCount > beforeRendered) {
    if (initial && current) scrollToRuleCard(current.rule.id, { initial });
    else scrollToNewestCard({ initial });
  } else if (current && current.rule.id !== previousCurrentId) {
    scrollToRuleCard(current.rule.id, { initial });
  }

  lastResolvedIds = resolvedIds;
  lastCurrentId = current?.rule.id ?? null;

  if (state.victory) {
    lockGameForVictory();
    saveState();
    if (!victoryShown && !initial) {
      const generation = sessionGeneration;
      window.setTimeout(() => {
        if (generation === sessionGeneration && state.victory) {
          showVictory({ expectedGeneration: generation });
        }
      }, 420);
    }
  } else {
    els.password.disabled = false;
    els.hintBtn.disabled = false;
    scheduleSave();
  }

  if (state.startAt !== null) {
    updateClock();
  }
}

function renderNewCards({ initial, animate }) {
  while (renderedCount < state.activeCount) {
    const rule = RULES[renderedCount];
    const card = createRuleCard(rule, renderedCount);
    if (!initial && animate) {
      card.classList.add("is-new");
      const generation = sessionGeneration;
      window.setTimeout(() => {
        if (generation === sessionGeneration && card.isConnected) card.classList.remove("is-new");
      }, 700);
    }
    els.rulesList.append(card);
    renderedCount += 1;
  }
}

function createRuleCard(rule) {
  const card = document.createElement("article");
  card.className = "rule-card";
  card.dataset.ruleId = rule.id;
  card.setAttribute("aria-label", `第 ${rule.code} 条：${rule.title}`);
  if (rule.amendment) card.classList.add("is-amendment");
  if (rule.final) card.classList.add("is-final");

  const rail = document.createElement("div");
  rail.className = "rule-rail";
  rail.setAttribute("aria-hidden", "true");
  rail.innerHTML = `
    <span class="rule-code">${rule.code}</span>
    <span class="rule-rail-line"></span>
    <span class="rule-rail-dot"></span>
  `;

  const main = document.createElement("div");
  main.className = "rule-main";

  const top = document.createElement("div");
  top.className = "rule-top";
  top.innerHTML = `
    <span class="rule-category">${rule.category}</span>
    <span class="rule-status" data-role="status">等待审查</span>
  `;

  const title = document.createElement("h3");
  title.textContent = rule.title;

  const text = document.createElement("p");
  text.className = "rule-text";
  text.innerHTML = rule.text;

  const live = document.createElement("div");
  live.className = "rule-live";
  live.dataset.role = "live";

  main.append(top, title, text, live);

  if (rule.challenge === "cat") {
    const cameo = document.createElement("div");
    cameo.className = "cat-cameo";
    cameo.setAttribute("aria-hidden", "true");
    cameo.innerHTML = '<span>🐈</span><span class="cat-paws">· · ·</span>';
    main.append(cameo);
  }

  if (rule.challenge) {
    main.append(createChallenge(rule));
  }

  const hint = document.createElement("div");
  hint.className = "rule-hint";
  hint.dataset.role = "hint";
  hint.hidden = true;
  hint.innerHTML = `<span class="rule-hint-label">HINT / 提示</span>${rule.hint}`;
  main.append(hint);

  card.append(rail, main);
  return card;
}

function createChallenge(rule) {
  const solved =
    (rule.challenge === "captcha" && state.captchaSolved) ||
    (rule.challenge === "pressure" && state.pressureSolved) ||
    (rule.challenge === "knight" && state.knightSolved);

  if (rule.challenge === "captcha") return createCaptchaChallenge(rule, solved);
  if (rule.challenge === "pressure") return createPressureChallenge(rule, solved);
  if (rule.challenge === "knight") return createKnightChallenge(rule, solved);
  return document.createElement("div");
}

function createCaptchaChallenge(rule, solved) {
  const wrap = document.createElement("div");
  wrap.className = "challenge captcha-challenge";
  wrap.dataset.challenge = "captcha";
  wrap.dataset.ruleId = rule.id;

  if (solved) {
    wrap.classList.add("is-solved");
    wrap.innerHTML = `
      <div class="challenge-label"><span>HUMAN VERIFICATION</span><b>PASSED</b></div>
      <div class="solved-stamp"><span class="stamp-mark" aria-hidden="true">✓</span><span>验证通过。你暂时是人类。</span></div>
    `;
    return wrap;
  }

  const messageId = `captcha-message-${rule.id}`;
  wrap.innerHTML = `
    <div class="challenge-label"><span>HUMAN VERIFICATION</span><b>5 CHARACTERS</b></div>
    <div class="captcha-display" data-captcha-display aria-hidden="true"></div>
    <span class="sr-only" data-captcha-accessible>验证码为 ${state.captchaCode.split("").join(" ")}</span>
    <div class="captcha-actions">
      <label class="sr-only" for="captcha-input-${rule.id}">输入验证码</label>
      <input
        id="captcha-input-${rule.id}"
        class="field"
        data-captcha-input
        type="text"
        inputmode="text"
        maxlength="${CAPTCHA_LENGTH}"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        placeholder="输入上方验证码"
        aria-describedby="${messageId}"
      />
      <button class="challenge-btn" type="button" data-action="captcha-submit">验证</button>
      <button class="challenge-btn challenge-btn-quiet" type="button" data-action="captcha-refresh" aria-label="换一个验证码" title="换一个验证码">↻</button>
    </div>
    <p class="challenge-message" id="${messageId}" data-captcha-message aria-live="polite">不区分大小写。这只是走个流程。</p>
  `;

  const display = wrap.querySelector("[data-captcha-display]");
  renderCaptchaChars(display, state.captchaCode);
  return wrap;
}

function renderCaptchaChars(display, code) {
  if (!display) return;
  display.replaceChildren();
  charsOf(code).forEach((char) => {
    const span = document.createElement("span");
    span.className = "captcha-char";
    span.textContent = char;
    span.style.setProperty("--r", `${(Math.random() * 11 - 5.5).toFixed(1)}deg`);
    span.style.setProperty("--y", `${(Math.random() * 7 - 3.5).toFixed(1)}px`);
    display.append(span);
  });
}

function createPressureChallenge(rule, solved) {
  const wrap = document.createElement("div");
  wrap.className = "challenge pressure-challenge";
  wrap.dataset.challenge = "pressure";
  wrap.dataset.ruleId = rule.id;
  wrap.classList.toggle("is-solved", solved);

  wrap.innerHTML = `
    <div class="pressure-info">
      <div class="pressure-meter" role="presentation">
        <div class="pressure-fill" data-pressure-fill style="width: ${solved ? 0 : 100}%"></div>
      </div>
      <div class="pressure-stats">
        <span>压力 <b data-pressure-percent>${solved ? 0 : 100}%</b></span>
        <span>连击 <b data-pressure-count>${solved ? PRESSURE_CLICKS : 0} / ${PRESSURE_CLICKS}</b></span>
      </div>
      <p class="challenge-message" data-pressure-message aria-live="polite">${
        solved ? "压力已归零。系统暂时不恨你了。" : "快速点击阀门。停顿超过一秒，压力会回满。"
      }</p>
    </div>
    <button class="valve-button" type="button" data-action="pressure-click" ${solved ? "disabled" : ""} aria-label="泄压阀">
      ${solved ? "SAFE" : "VENT"}
    </button>
  `;
  return wrap;
}

function createKnightChallenge(rule, solved) {
  const wrap = document.createElement("div");
  wrap.className = "challenge knight-challenge";
  wrap.dataset.challenge = "knight";
  wrap.dataset.ruleId = rule.id;
  wrap.classList.toggle("is-solved", solved);

  const board = document.createElement("div");
  board.className = "knight-board";
  board.setAttribute("role", "group");
  board.setAttribute("aria-label", "骑士棋盘");

  board.append(makeBoardLabel("", "board-label board-corner"));
  KNIGHT_COORDS.forEach((coord) => board.append(makeBoardLabel(coord, "board-label")));

  KNIGHT_RANKS.forEach((rank) => {
    board.append(makeBoardLabel(String(rank), "board-label"));
    KNIGHT_COORDS.forEach((coord, coordIndex) => {
      const square = `${coord}${rank}`;
      const isLight = (coordIndex + rank) % 2 === 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `board-square ${isLight ? "is-light" : ""}`;
      button.dataset.square = square;

      let label = `${square}，空格`;
      if (!solved && square === "a2") {
        button.innerHTML = '<span class="piece piece-knight" aria-hidden="true">♞</span>';
        label = `${square}，白骑士`;
      } else if (!solved && square === "c3") {
        button.classList.add("is-target");
        button.innerHTML = '<span class="piece piece-bug" aria-hidden="true">🐛</span>';
        label = `${square}，甲虫`;
      } else if (solved && square === "c3") {
        button.classList.add("is-captured");
        button.innerHTML = '<span class="piece piece-knight" aria-hidden="true">♞</span>';
        label = `${square}，骑士抓住了甲虫`;
      }

      button.setAttribute("aria-label", label);
      if (solved) button.disabled = true;
      board.append(button);
    });
  });

  const side = document.createElement("div");
  side.className = "knight-side";
  const hasCoordinate = state.password.includes("c3");
  side.innerHTML = `
    <div class="challenge-label"><span>ONE MOVE</span><b>${solved ? "CAPTURED" : "FIND THE BUG"}</b></div>
    <p class="challenge-message" aria-live="polite">${solved ? "抓到了。棋盘上只剩一只满意的骑士。" : "点击甲虫所在的格子。马走「日」。"}</p>
    <div class="knight-message">
      <span class="coordinate-pill ${solved && hasCoordinate ? "is-good" : ""}" data-coordinate-pill>
        ${solved ? (hasCoordinate ? "坐标 c3 已写入密码" : "坐标 c3 尚未写入密码") : "坐标尚未发现"}
      </span>
    </div>
    <p class="knight-solved-note">甲虫坐标：c3。现在把 c3 抄进密码，规则才会计数。</p>
  `;

  wrap.append(board, side);
  return wrap;
}

function makeBoardLabel(text, className) {
  const label = document.createElement("span");
  label.className = className;
  label.textContent = text;
  label.setAttribute("aria-hidden", "true");
  return label;
}

function updateCards(statuses, current) {
  statuses.forEach((status) => {
    const card = els.rulesList.querySelector(`[data-rule-id="${status.rule.id}"]`);
    if (!card) return;

    const isCurrent = current?.rule.id === status.rule.id;
    card.classList.toggle("is-current", isCurrent);
    card.classList.toggle("is-passed", status.passed && !status.retired);
    card.classList.toggle("is-retired", Boolean(status.retired));
    card.classList.toggle("is-failed", !status.passed);
    card.classList.toggle("is-amendment", Boolean(status.rule.amendment));
    card.classList.toggle("is-final", Boolean(status.rule.final));

    if (isCurrent) card.setAttribute("aria-current", "step");
    else card.removeAttribute("aria-current");

    const statusEl = card.querySelector('[data-role="status"]');
    if (statusEl) {
      statusEl.textContent = status.retired
        ? "已废止"
        : status.passed
          ? "通过"
          : isCurrent
            ? "待处理"
            : "未通过";
    }

    const hintEl = card.querySelector('[data-role="hint"]');
    if (hintEl) hintEl.hidden = !(hintOpen && isCurrent);

    updateRuleLive(card, status);
    syncChallenge(card, status.rule);
  });
}

function updateRuleLive(card, status) {
  const live = card.querySelector('[data-role="live"]');
  if (!live) return;

  if (status.rule.id === "digit-sum-25" || status.rule.id === "digit-sum-42") {
    if (status.retired) {
      live.innerHTML = '<span class="live-pill">条款已废止 · 由第 13 条取代</span>';
      return;
    }
    const target = status.rule.id === "digit-sum-42" ? 42 : 25;
    const total = digitSum(state.password);
    live.innerHTML = `<span class="live-pill ${total === target ? "is-good" : ""}">当前数字和 ${total} / ${target}</span>`;
    return;
  }

  if (status.rule.id === "no-e") {
    const count = charsOf(state.password).filter((char) => char === "e").length;
    live.innerHTML = `<span class="live-pill ${count === 0 ? "is-good" : "is-bad"}">${
      count === 0 ? "没有发现小写 e" : `发现 ${count} 个小写 e`
    }</span>`;
    return;
  }

  if (status.rule.id === "exact-42") {
    const count = charsOf(state.password).length;
    live.innerHTML = `<span class="live-pill ${count === 42 ? "is-good" : "is-bad"}">当前 ${count} / 42 字符</span>`;
    return;
  }

  live.replaceChildren();
}

function syncChallenge(card, rule) {
  const existing = card.querySelector("[data-challenge]");
  if (!existing) return;

  const solved =
    (rule.challenge === "captcha" && state.captchaSolved) ||
    (rule.challenge === "pressure" && state.pressureSolved) ||
    (rule.challenge === "knight" && state.knightSolved);

  if (solved && !existing.classList.contains("is-solved")) {
    existing.replaceWith(createChallenge(rule));
    return;
  }

  if (rule.challenge === "knight") {
    const pill = existing.querySelector("[data-coordinate-pill]");
    if (pill) {
      const hasCoordinate = state.password.includes("c3");
      pill.textContent = state.knightSolved
        ? hasCoordinate
          ? "坐标 c3 已写入密码"
          : "坐标 c3 尚未写入密码"
        : "坐标尚未发现";
      pill.classList.toggle("is-good", state.knightSolved && hasCoordinate);
    }
  }
}

function updateProgress({ statuses, resolvedCount, current }) {
  const segments = Array.from(els.progressSegments.children);
  segments.forEach((segment, index) => {
    const rule = RULES[index];
    const status = index < state.activeCount ? getStatusForRule(rule.id) : null;
    segment.className = "";
    segment.classList.remove("is-resolved", "is-current", "is-retired");

    if (status?.retired) {
      segment.classList.add("is-retired");
    } else if (status?.passed) {
      segment.classList.add("is-resolved");
    } else if (current?.rule.id === rule.id) {
      segment.classList.add("is-current");
    }
  });

  els.progressSegments.setAttribute("aria-valuenow", String(resolvedCount));
  els.progressSegments.setAttribute("aria-valuetext", `已解决 ${resolvedCount} 条，共 ${TOTAL_RULES} 条`);
  const paddedResolved = String(resolvedCount).padStart(2, "0");
  const paddedActive = String(state.activeCount).padStart(2, "0");
  els.charCount.textContent = String(charsOf(state.password).length);
  els.headerRuleCount.textContent = paddedActive;
  els.globalScore.textContent = state.victory ? String(TOTAL_RULES) : paddedResolved;
  els.resolvedLabel.textContent = `${resolvedCount} / ${TOTAL_RULES} 条已解决`;
  els.teaserCount.textContent = String(TOTAL_RULES - state.activeCount);
  els.lockedTeaser.hidden = state.activeCount >= TOTAL_RULES || state.victory;

  const failing = statuses.filter((status) => !status.passed).length;
  const pressure = state.victory
    ? 0
    : Math.min(99, Math.round(7 + (state.activeCount / TOTAL_RULES) * 72 + failing * 3));
  els.pressureLabel.textContent = `系统压力 ${String(pressure).padStart(2, "0")}%`;

  document.title = state.victory
    ? "通关 · 密码暴走"
    : `(${paddedResolved}/${TOTAL_RULES}) 密码暴走 · PASSWORD PANIC`;
}

function getStatusForRule(ruleId) {
  const context = makeContext(state.password, state);
  const ids = activeRuleIds(state.activeCount);
  const rule = RULES.find((candidate) => candidate.id === ruleId);
  return rule ? resolveRule(rule, context, ids) : null;
}

function updateStatusPanels({ statuses, resolvedCount, current, allResolved }) {
  const failing = statuses.filter((status) => !status.passed).length;
  if (state.victory) {
    els.inputState.textContent = "已批准 / GRANTED";
  } else if (!state.password) {
    els.inputState.textContent = "等待输入";
  } else if (allResolved) {
    els.inputState.textContent = "审查完成";
  } else {
    els.inputState.textContent = `${failing} 条待处理`;
  }

  els.consoleAudit.textContent = `${String(resolvedCount).padStart(2, "0")} / ${TOTAL_RULES} RESOLVED`;
  els.consoleHint.textContent = hintOpen ? "VISIBLE / CURRENT RULE" : "NONE REQUESTED";
  els.consoleStatus.textContent = state.victory
    ? "ACCESS GRANTED"
    : failing > 0
      ? `${String(failing).padStart(2, "0")} ISSUES OPEN`
      : "ALL SYSTEMS NOMINAL*";

  const active = state.activeCount;
  let systemLabel = "SYSTEM: CALIBRATING";
  let threat = "稳定";
  if (state.victory) {
    systemLabel = "SYSTEM: ACCESS GRANTED";
    threat = "已放行";
  } else if (active >= 21) {
    systemLabel = "SYSTEM: MELTING";
    threat = "失控";
  } else if (active >= 18) {
    systemLabel = "SYSTEM: CRITICAL";
    threat = "临界";
  } else if (active >= 14) {
    systemLabel = "SYSTEM: OVERHEATING";
    threat = "过热";
  } else if (active >= 9) {
    systemLabel = "SYSTEM: MONITORING";
    threat = "升温";
  } else if (active >= 5) {
    systemLabel = "SYSTEM: UNSTABLE";
    threat = "波动";
  }
  els.systemState.textContent = systemLabel;
  els.threatLevel.textContent = threat;

  const inputTone = failing > 0 && state.password ? "alert" : "neutral";
  els.inputState.dataset.tone = inputTone;
  els.currentObjective.textContent = state.victory
    ? "全部通过 · ACCESS GRANTED"
    : current
      ? `第 ${current.rule.code} 条 · ${current.rule.title}`
      : `${TOTAL_RULES} 条规则全部通过`;
}

function updateObjective({ current, allResolved }) {
  if (state.victory) {
    els.currentObjective.textContent = "全部通过 · ACCESS GRANTED";
    els.currentHint.hidden = true;
    return;
  }

  if (!current) {
    els.currentObjective.textContent = allResolved ? "全部通过 · 正在发放权限…" : "等待下一条规则";
    els.currentHint.hidden = true;
    return;
  }

  els.currentObjective.textContent = `第 ${current.rule.code} 条 · ${current.rule.title}`;
  if (hintOpen) {
    els.currentHint.hidden = false;
    els.currentHint.innerHTML = current.rule.hint;
  } else {
    els.currentHint.hidden = true;
    els.currentHint.replaceChildren();
  }
}

function updateHero({ resolvedCount }) {
  const percent = Math.round((resolvedCount / TOTAL_RULES) * 100);
  els.gauge.style.setProperty("--progress", `${percent * 3.6}deg`);
  els.gaugeValue.textContent = String(percent).padStart(3, "0");
  els.heroRules.textContent = String(state.activeCount).padStart(2, "0");
  els.heroReview.textContent = `${percent}%`;
}

function updateInputMeta(context) {
  const charCount = context.chars.length;
  els.charCount.textContent = String(charCount);
  els.digitSum.textContent = String(context.digitSum);

  const activeTarget = state.activeCount >= 13 ? 42 : 25;
  const digitTargetMet = context.digitSum === activeTarget;
  els.digitSum.classList.toggle("is-good", digitTargetMet);
  els.digitSum.classList.toggle("is-bad", Boolean(state.password) && !digitTargetMet);

  if (state.password) {
    els.digitSum.classList.toggle("is-bad", !digitTargetMet);
  } else {
    els.digitSum.classList.remove("is-good", "is-bad");
  }
}

function updateCurrentHint({ current, previousCurrentId }) {
  if (current?.rule.id !== previousCurrentId) {
    hintOpen = false;
    els.hintBtn.setAttribute("aria-pressed", "false");
  }

  const hintEls = els.rulesList.querySelectorAll('[data-role="hint"]');
  hintEls.forEach((hintEl) => {
    const card = hintEl.closest(".rule-card");
    const isCurrent = current && card?.dataset.ruleId === current.rule.id;
    hintEl.hidden = !(hintOpen && isCurrent);
  });

  if (hintOpen && current) {
    els.currentHint.hidden = false;
    els.currentHint.innerHTML = current.rule.hint;
    els.consoleHint.textContent = "VISIBLE / CURRENT RULE";
  } else {
    els.currentHint.hidden = true;
    els.currentHint.replaceChildren();
    els.consoleHint.textContent = "NONE REQUESTED";
  }
}

function scrollToNewestCard({ initial }) {
  const generation = sessionGeneration;
  window.setTimeout(() => {
    if (generation !== sessionGeneration) return;
    const newest = els.rulesList.lastElementChild;
    if (!newest) return;
    scrollToCardElement(newest, initial);
  }, 80);
}

function scrollToRuleCard(ruleId, { initial = false } = {}) {
  const generation = sessionGeneration;
  window.setTimeout(() => {
    if (generation !== sessionGeneration) return;
    const card = els.rulesList.querySelector(`[data-rule-id="${ruleId}"]`);
    if (!card) return;
    scrollToCardElement(card, initial);
  }, 80);
}

function scrollToCardElement(card, initial = false) {
  if (els.rulesList.scrollHeight <= els.rulesList.clientHeight + 8) return;
  const scrollerTop = els.rulesList.scrollTop;
  const scrollerBottom = scrollerTop + els.rulesList.clientHeight;
  const cardTop = card.offsetTop;
  const cardBottom = cardTop + card.offsetHeight;
  if (cardTop >= scrollerTop && cardBottom <= scrollerBottom) return;
  els.rulesList.scrollTo({
    top: Math.max(0, cardTop - 10),
    behavior: initial || reduceMotion.matches ? "auto" : "smooth",
  });
}

function setNotice(message, tone = "") {
  els.notice.textContent = message;
  els.notice.classList.toggle("is-good", tone === "good");
  els.notice.classList.toggle("is-alert", tone === "alert");
}

/* ============================== Interactions ============================== */

function handlePasswordInput() {
  if (passwordComposing) return;

  const raw = els.password.value;
  const clean = normalizePassword(raw);
  if (raw !== clean) {
    const selection = els.password.selectionStart ?? raw.length;
    const cleanPrefix = normalizePassword(raw.slice(0, selection));
    els.password.value = clean;
    const next = Math.min(cleanPrefix.length, clean.length);
    els.password.setSelectionRange(next, next);
  }

  if (!state.startAt && clean.length > 0) {
    state.startAt = Date.now();
  }

  state.password = clean;
  disarmReset();
  syncUI();
}

function toggleHint() {
  if (state.victory) return;
  hintOpen = !hintOpen;
  els.hintBtn.setAttribute("aria-pressed", String(hintOpen));
  if (hintOpen) playSound("tick");
  syncUI();
}

function handleRuleListClick(event) {
  const square = event.target.closest(".board-square");
  if (square) {
    handleKnightSquare(square);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  const action = actionButton?.dataset.action;
  if (!action) return;

  if (action === "captcha-submit") {
    submitCaptcha(actionButton.closest(".captcha-challenge"));
  } else if (action === "captcha-refresh") {
    refreshCaptcha(actionButton.closest(".captcha-challenge"));
  } else if (action === "pressure-click") {
    handlePressureClick(actionButton.closest(".pressure-challenge"));
  }
}

function handleRuleListKeydown(event) {
  const input = event.target.closest("[data-captcha-input]");
  if (input && event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    submitCaptcha(input.closest(".captcha-challenge"));
  }
}

function submitCaptcha(challenge) {
  if (!challenge || state.captchaSolved) return;
  const input = challenge.querySelector("[data-captcha-input]");
  const message = challenge.querySelector("[data-captcha-message]");
  if (!input) return;

  const value = input.value.trim().toUpperCase();
  if (!value) {
    setCaptchaMessage(message, "先输入验证码。", "error");
    input.focus();
    return;
  }

  if (value === state.captchaCode) {
    state.captchaSolved = true;
    setCaptchaMessage(message, "验证通过。正在记录你的存在。", "success");
    syncUI();
    const generation = sessionGeneration;
    window.setTimeout(() => {
      if (generation === sessionGeneration) els.password.focus({ preventScroll: true });
    }, 100);
  } else {
    setCaptchaMessage(message, "验证码不匹配。大小写不影响结果，请再检查字符。", "error");
    playSound("error");
    challenge.classList.remove("is-solved");
    input.setAttribute("aria-invalid", "true");
    input.select();
    if (!reduceMotion.matches) {
      challenge.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-4px)" },
          { transform: "translateX(4px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 220, easing: "ease" },
      );
    }
    const generation = sessionGeneration;
    window.setTimeout(() => {
      if (generation === sessionGeneration && input.isConnected) input.removeAttribute("aria-invalid");
    }, 900);
  }
}

function refreshCaptcha(challenge) {
  if (!challenge || state.captchaSolved) return;
  state.captchaCode = createCaptcha();
  const replacement = createCaptchaChallenge(
    RULES.find((rule) => rule.id === "captcha"),
    false,
  );
  challenge.replaceWith(replacement);
  const input = replacement.querySelector("[data-captcha-input]");
  const message = replacement.querySelector("[data-captcha-message]");
  setCaptchaMessage(message, "验证码已更换。这次看仔细。", "");
  input?.focus();
  scheduleSave();
  playSound("tick");
}

function setCaptchaMessage(message, text, tone) {
  if (!message) return;
  message.textContent = text;
  message.classList.toggle("is-error", tone === "error");
  message.classList.toggle("is-success", tone === "success");
}

function handlePressureClick(challenge) {
  if (!challenge || state.pressureSolved) return;
  window.clearTimeout(pressureTimer);
  pressureClicks += 1;
  playSound("tick");

  const fill = challenge.querySelector("[data-pressure-fill]");
  const percent = challenge.querySelector("[data-pressure-percent]");
  const count = challenge.querySelector("[data-pressure-count]");
  const message = challenge.querySelector("[data-pressure-message]");
  const remaining = Math.max(0, 100 - pressureClicks * (100 / PRESSURE_CLICKS));

  if (fill) fill.style.width = `${remaining}%`;
  if (percent) percent.textContent = `${Math.round(remaining)}%`;
  if (count) count.textContent = `${Math.min(pressureClicks, PRESSURE_CLICKS)} / ${PRESSURE_CLICKS}`;
  challenge.classList.toggle("is-warming", pressureClicks >= 6);

  if (pressureClicks >= PRESSURE_CLICKS) {
    state.pressureSolved = true;
    if (message) {
      message.textContent = "压力归零。系统重新开始假装一切正常。";
      message.classList.add("is-success");
    }
    syncUI();
    return;
  }

  if (message) message.textContent = "别停。再快一点。";
  const generation = sessionGeneration;
  pressureTimer = window.setTimeout(() => {
    if (generation === sessionGeneration) resetPressureCombo(challenge, generation);
  }, PRESSURE_TIMEOUT);
}

function resetPressureCombo(challenge, expectedGeneration = sessionGeneration) {
  if (expectedGeneration !== sessionGeneration) return;
  pressureClicks = 0;
  pressureTimer = null;
  if (!document.body.contains(challenge)) return;
  challenge.classList.remove("is-warming");
  const fill = challenge.querySelector("[data-pressure-fill]");
  const percent = challenge.querySelector("[data-pressure-percent]");
  const count = challenge.querySelector("[data-pressure-count]");
  const message = challenge.querySelector("[data-pressure-message]");
  if (fill) fill.style.width = "100%";
  if (percent) percent.textContent = "100%";
  if (count) count.textContent = `0 / ${PRESSURE_CLICKS}`;
  if (message) {
    message.textContent = "连击中断。压力回满，重新开始。";
    message.classList.remove("is-success");
    message.classList.add("is-error");
  }
  playSound("error");
}

function handleKnightSquare(squareButton) {
  if (!squareButton || state.knightSolved) return;
  const square = squareButton.dataset.square;
  if (square === "c3") {
    state.knightSolved = true;
    if (!state.password.includes("c3")) playSound("pass");
    syncUI();
    setNotice(
      state.password.includes("c3")
        ? "甲虫已抓获。密码里已有坐标 c3，条款 17 通过。"
        : "甲虫已抓获。把坐标 c3 抄进密码。",
      state.password.includes("c3") ? "good" : "",
    );
    return;
  }

  squareButton.classList.add("is-wrong");
  playSound("error");
  const generation = sessionGeneration;
  window.setTimeout(() => {
    if (generation === sessionGeneration && squareButton.isConnected) squareButton.classList.remove("is-wrong");
  }, 360);
  const message = squareButton.closest(".knight-challenge")?.querySelector(".challenge-message");
  if (message) {
    message.textContent = square === "a2" ? "那是骑士的起点。马走「日」。" : "这里没有甲虫。马走「日」。";
    message.classList.add("is-error");
  }
}

function copyPassword() {
  if (!state.password) {
    showToast("密码还是空的。先写点什么，哪怕只是 abc。", "alert");
    return;
  }
  const generation = sessionGeneration;
  copyText(state.password).then((ok) => {
    if (generation !== sessionGeneration) return;
    showToast(ok ? "密码已复制。请不要拿它去注册任何网站。" : "复制失败。手动选中密码吧。", ok ? "" : "alert");
  });
}

function shareReport() {
  if (!state.victory) return;
  const seconds = formatDuration(state.finishMs ?? 0);
  const chars = charsOf(state.password).length;
  const report =
    `我在《密码暴走》里用 ${chars} 个字符通过了 ${TOTAL_RULES} 条规则，用时 ${seconds}。\n` +
    `${window.location.origin}${window.location.pathname}\n` +
    "你能活到第几条？";
  const generation = sessionGeneration;
  copyText(report).then((ok) => {
    if (generation !== sessionGeneration) return;
    showToast(ok ? "战报已复制。去吓吓你的朋友。" : "复制失败。请手动复制页面地址。", ok ? "" : "alert");
  });
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Fall through to the old reliable textarea. */
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    area.style.top = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function handleResetClick() {
  if (loadKind === "incompatible") {
    showToast("检测到更高版本存档。请使用上方“开始新局”明确覆盖。", "alert");
    return;
  }

  if (resetArmed) {
    newGame({ focus: true });
    return;
  }

  if (!hasProgress()) {
    newGame({ focus: true });
    return;
  }

  resetArmed = true;
  els.resetBtn.classList.add("is-armed");
  els.resetBtn.innerHTML = '<span class="btn-glyph" aria-hidden="true">!</span> 确认清空';
  window.clearTimeout(resetTimer);
  resetTimer = window.setTimeout(disarmReset, 3200);
  showToast("再按一次「确认清空」。现已通过和已输入的内容都会消失。", "alert");
}

function disarmReset() {
  window.clearTimeout(resetTimer);
  resetTimer = null;
  if (!resetArmed) return;
  resetArmed = false;
  els.resetBtn.classList.remove("is-armed");
  els.resetBtn.innerHTML = '<span class="btn-glyph" aria-hidden="true">↺</span> 重开';
}

function hasProgress() {
  return (
    state.password.length > 0 ||
    state.activeCount > 1 ||
    state.captchaSolved ||
    state.pressureSolved ||
    state.knightSolved ||
    Boolean(state.victory)
  );
}

function newGame({ focus = false, allowOverwrite = false } = {}) {
  if (loadKind === "incompatible" && !allowOverwrite) return;

  sessionGeneration += 1;
  window.clearTimeout(pressureTimer);
  window.clearTimeout(saveTimer);
  window.clearTimeout(resetTimer);
  window.clearTimeout(toastTimer);
  window.clearTimeout(storageStatusTimer);
  pressureTimer = null;
  saveTimer = null;
  resetTimer = null;
  toastTimer = null;
  storageStatusTimer = null;
  pressureClicks = 0;
  passwordComposing = false;
  disarmReset();
  hideVictory({ restoreFocus: false, revealResult: false });
  hideToast();

  if (allowOverwrite && loadKind === "incompatible") {
    storageWritable = true;
    storageFailureShown = false;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The next save attempt will surface a persistent failure message.
  }

  loadKind = "fresh";
  state = initialState();
  hintOpen = false;
  lastResolvedIds = new Set();
  lastCurrentId = null;
  renderedCount = 0;
  victoryShown = false;
  els.rulesList.replaceChildren();
  els.password.value = "";
  els.password.disabled = false;
  els.hintBtn.disabled = false;
  els.hintBtn.setAttribute("aria-pressed", "false");
  els.lockedTeaser.hidden = false;
  els.storageStatus.hidden = true;
  els.startFreshBtn.hidden = true;
  els.showVictoryBtn.hidden = true;
  updateClock();
  syncUI({ initial: true });
  saveState();

  if (focus) {
    els.password.focus({ preventScroll: false });
  }
}

/* ============================== Sounds ============================== */

function toggleSound() {
  soundOn = !soundOn;
  saveSoundPreference();
  syncSoundButton();
  if (soundOn) playSound("tick");
}

function syncSoundButton() {
  els.soundToggle.setAttribute("aria-pressed", String(soundOn));
  els.soundLabel.textContent = `声音 ${soundOn ? "开" : "关"}`;
  els.soundToggle.setAttribute("aria-label", soundOn ? "关闭音效" : "开启音效");
}

function ensureAudio() {
  if (!soundOn) return null;
  try {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      audioContext = new AudioCtx();
    }
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

function playTone(frequency, duration, { type = "sine", gain = 0.022, delay = 0, slide = null } = {}) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (slide) oscillator.frequency.exponentialRampToValueAtTime(slide, start + duration);
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(volume);
  volume.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playSound(kind) {
  if (!soundOn) return;
  if (kind === "tick") {
    playTone(310, 0.035, { type: "square", gain: 0.008 });
  } else if (kind === "pass") {
    playTone(660, 0.08, { type: "sine", gain: 0.016 });
    playTone(990, 0.1, { type: "sine", gain: 0.013, delay: 0.065 });
  } else if (kind === "unlock") {
    playTone(440, 0.07, { type: "triangle", gain: 0.018 });
    playTone(660, 0.12, { type: "triangle", gain: 0.018, delay: 0.08 });
    playTone(880, 0.13, { type: "triangle", gain: 0.012, delay: 0.17 });
  } else if (kind === "error") {
    playTone(150, 0.12, { type: "sawtooth", gain: 0.012, slide: 100 });
  } else if (kind === "win") {
    [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => {
      playTone(note, 0.22, { type: "triangle", gain: 0.014, delay: index * 0.11 });
    });
  }
}

/* ============================== Victory ============================== */

function lockGameForVictory() {
  els.password.disabled = true;
  els.hintBtn.disabled = true;
  els.inputState.textContent = "已批准 / GRANTED";
  els.lockedTeaser.hidden = true;
}

function showVictory({ silent = false, expectedGeneration = sessionGeneration } = {}) {
  if (expectedGeneration !== sessionGeneration || !state.victory || victoryShown) return;
  victoryShown = true;
  victoryReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  els.victoryChars.textContent = String(charsOf(state.password).length);
  els.victoryTime.textContent = formatDuration(state.finishMs ?? 0);
  els.victoryPassword.textContent = state.password;
  els.showVictoryBtn.hidden = true;
  buildConfetti();
  els.victory.hidden = false;
  document.body.style.overflow = "hidden";
  els.shareBtn.focus({ preventScroll: true });
  if (!silent) playSound("win");
  const generation = sessionGeneration;
  window.setTimeout(() => {
    if (generation === sessionGeneration && !els.victory.hidden) {
      els.shareBtn.focus({ preventScroll: true });
    }
  }, 80);
}

function hideVictory({ restoreFocus = false, revealResult = false } = {}) {
  if (!els.victory) return;
  els.victory.hidden = true;
  els.confetti.replaceChildren();
  document.body.style.overflow = "";
  victoryShown = false;

  const keepResultButton = revealResult && state.victory;
  els.showVictoryBtn.hidden = !keepResultButton;
  if (restoreFocus && keepResultButton) {
    els.showVictoryBtn.focus({ preventScroll: true });
  } else if (restoreFocus && victoryReturnFocus?.isConnected) {
    victoryReturnFocus.focus({ preventScroll: true });
  }
  victoryReturnFocus = null;
}

function buildConfetti() {
  if (reduceMotion.matches) return;
  els.confetti.replaceChildren();
  const colors = ["#d8ff4f", "#7ceccb", "#eef2e4", "#ff674d"];
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 72; index += 1) {
    const bit = document.createElement("i");
    bit.style.setProperty("--w", `${4 + Math.random() * 7}px`);
    bit.style.setProperty("--h", `${8 + Math.random() * 14}px`);
    bit.style.setProperty("--color", colors[index % colors.length]);
    bit.style.setProperty("--duration", `${2.6 + Math.random() * 2.8}s`);
    bit.style.setProperty("--delay", `${Math.random() * 1.2}s`);
    bit.style.setProperty("--dx", `${Math.round((Math.random() - 0.5) * 340)}px`);
    bit.style.setProperty("--rot", `${Math.round(240 + Math.random() * 900)}deg`);
    bit.style.left = `${Math.random() * 100}%`;
    fragment.append(bit);
  }
  els.confetti.append(fragment);
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape" && !els.victory.hidden) {
    event.preventDefault();
    hideVictory({ restoreFocus: true, revealResult: true });
    return;
  }
  if (event.key === "Escape" && resetArmed) {
    disarmReset();
    return;
  }
  if (!els.victory.hidden) {
    trapFocus(event);
  }
}

function trapFocus(event) {
  if (event.key !== "Tab") return;
  const focusable = [els.shareBtn, els.replayBtn].filter((el) => !el.disabled);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ============================== Clock / toast ============================== */

function startClock() {
  window.clearInterval(clockTimer);
  clockTimer = window.setInterval(updateClock, 1000);
  updateClock();
}

function updateClock() {
  if (!els.sessionTime) return;
  let elapsed = 0;
  if (state.victory) {
    elapsed = state.finishMs ?? 0;
  } else if (state.startAt) {
    elapsed = Date.now() - state.startAt;
  }
  els.sessionTime.textContent = formatDuration(elapsed);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function showToast(message, tone = "") {
  if (!els.toast) return;
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("is-alert", tone === "alert");
  els.toast.classList.add("is-visible");
  const generation = sessionGeneration;
  toastTimer = window.setTimeout(() => {
    if (generation === sessionGeneration) hideToast();
  }, 3000);
}

function hideToast() {
  window.clearTimeout(toastTimer);
  toastTimer = null;
  els.toast?.classList.remove("is-visible");
}
