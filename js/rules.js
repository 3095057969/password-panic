/**
 * PASSWORD PANIC — rule definitions and pure checks.
 * All copy, rules, and code in this project are original.
 */

export const TOTAL_RULES = 21;

export const ANIMALS = ["🐱", "🐶", "🐸", "🦊", "🐼", "🐙", "🐢", "🐝"];
export const SEASONS = ["春", "夏", "秋", "冬"];
export const ALLOWED_SYMBOLS = "!@#$%^&*";

export function charsOf(value) {
  return Array.from(value ?? "");
}

export function digitSum(value) {
  return charsOf(value).reduce((sum, char) => (/^[0-9]$/.test(char) ? sum + Number(char) : sum), 0);
}

export function countLowercaseE(value) {
  return charsOf(value).filter((char) => char === "e").length;
}

export function hasTriple(value) {
  const chars = charsOf(value);
  for (let index = 2; index < chars.length; index += 1) {
    if (chars[index] === chars[index - 1] && chars[index] === chars[index - 2]) {
      return true;
    }
  }
  return false;
}

export function makeContext(password, state = {}) {
  return {
    password,
    chars: charsOf(password),
    digitSum: digitSum(password),
    lowercaseECount: countLowercaseE(password),
    captchaSolved: Boolean(state.captchaSolved),
    pressureSolved: Boolean(state.pressureSolved),
    knightSolved: Boolean(state.knightSolved),
  };
}

/**
 * A rule can be retired by a later amendment. Retired rules stay visible in
 * the queue, count as resolved, and never fail again.
 */
export const RULES = [
  {
    id: "length-8",
    code: "01",
    category: "LENGTH",
    title: "八字符起步",
    text: "先来点普通的：密码至少需要 <b>8</b> 个字符。享受这段还没被刁难的时光。",
    hint: "随便输入 8 个字符。真的，后面你会怀念这一刻。",
    test: ({ chars }) => chars.length >= 8,
  },
  {
    id: "mixed-case",
    code: "02",
    category: "CHARACTER SET",
    title: "大小写与数字",
    text: "包含至少一个大写字母、一个小写字母和一个数字。它们没有用，但系统喜欢。",
    hint: "试试 <code>Mango1</code> 这样的组合。",
    test: ({ password }) => /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password),
  },
  {
    id: "symbol",
    code: "03",
    category: "CHARACTER SET",
    title: "符号税",
    text: `至少包含一个符号：<code>${ALLOWED_SYMBOLS}</code>。空格不算，叹气也不算。`,
    hint: "加一个 <code>!</code> 或 <code>#</code>。",
    test: ({ password }) => charsOf(password).some((char) => ALLOWED_SYMBOLS.includes(char)),
  },
  {
    id: "digit-sum-25",
    code: "04",
    category: "ARITHMETIC",
    title: "数字和：25",
    text: "把密码里出现的所有数字加起来，总和必须等于 <b>25</b>。",
    hint: "9 + 9 + 7 = 25。数字可以分散在密码里。",
    live: "digit-sum",
    retiredBy: "digit-sum-42",
    test: ({ digitSum: total }) => total === 25,
  },
  {
    id: "animal",
    code: "05",
    category: "MENAGERIE",
    title: "动物出没",
    text: `密码里必须住进一只动物：<span class="animal-options">${ANIMALS.join(" ")}</span>。`,
    hint: "从上面那排小动物里挑一个复制进去。",
    test: ({ password }) => ANIMALS.some((animal) => password.includes(animal)),
  },
  {
    id: "mango",
    code: "06",
    category: "LEXICON",
    title: "芒果条款",
    text: "必须包含小写单词 <code>mango</code>。为什么是芒果？审计部门不解释。",
    hint: "就是五个字母：m a n g o，全部小写。",
    test: ({ password }) => password.includes("mango"),
  },
  {
    id: "roman",
    code: "07",
    category: "HISTORY",
    title: "罗马遗产",
    text: "包含罗马数字 <code>IV</code>，也就是 4。别问为什么不是 5。",
    hint: "输入大写的 I 和 V。",
    test: ({ password }) => password.includes("IV"),
  },
  {
    id: "gold",
    code: "08",
    category: "CHEMISTRY",
    title: "元素收藏",
    text: "包含金的化学元素符号 <code>Au</code>。元素周期表是你的新密码本。",
    hint: "金的符号是 A 大写、u 小写。",
    test: ({ password }) => password.includes("Au"),
  },
  {
    id: "captcha",
    code: "09",
    category: "HUMAN CHECK",
    title: "你是人类吗",
    text: "机器开始怀疑你了。完成下方的人机验证，证明你不是一台特别执着的脚本。",
    hint: "看清验证码，区分大小写即可。验证码只用于验证，不用写进密码。",
    challenge: "captcha",
    test: ({ captchaSolved }) => captchaSolved,
  },
  {
    id: "length-20",
    code: "10",
    category: "LENGTH",
    title: "二十字符俱乐部",
    text: "密码长度至少达到 <b>20</b> 个字符。短密码让他们没有安全感。",
    hint: "再加点废话，凑到 20 个字符。",
    test: ({ chars }) => chars.length >= 20,
  },
  {
    id: "cat",
    code: "11",
    category: "INCIDENT",
    title: "猫踩键盘",
    text: "一只猫刚刚踩过键盘。现在密码里必须有「<b>喵</b>」。它不道歉。",
    hint: "输入汉字「喵」。猫在旁边看着。",
    challenge: "cat",
    test: ({ password }) => password.includes("喵"),
  },
  {
    id: "no-e",
    code: "12",
    category: "CENSORSHIP",
    title: "字母 e 禁令",
    text: "小写字母 <code>e</code> 现在是违禁品。大写 <code>E</code> 暂时安全。",
    hint: "逐字检查，把所有小写 e 删掉或换成别的字母。",
    live: "no-e",
    test: ({ lowercaseECount }) => lowercaseECount === 0,
  },
  {
    id: "digit-sum-42",
    code: "13",
    category: "AMENDMENT",
    title: "修正案：42",
    text: "修正案 4.2：所有数字之和从 25 改为 <b>42</b>。第 04 条自动废止。",
    hint: "用不重复的数字凑 42，例如 9 + 8 + 7 + 6 + 5 + 4 + 3。",
    live: "digit-sum",
    amendment: true,
    test: ({ digitSum: total }) => total === 42,
  },
  {
    id: "pressure",
    code: "14",
    category: "STRESS TEST",
    title: "压力测试",
    text: "系统压力过高。快速连点泄压阀，把压力降到 0。停顿太久，压力会回满。",
    hint: "连续快速点击 10 次，不要停下来思考人生。",
    challenge: "pressure",
    test: ({ pressureSolved }) => pressureSolved,
  },
  {
    id: "no-triple",
    code: "15",
    category: "PATTERN",
    title: "禁止三连",
    text: "不允许连续出现三个相同字符，例如 <code>aaa</code>、<code>111</code> 或 <code>!!!</code>。",
    hint: "检查有没有三个一模一样的字符紧挨在一起。",
    test: ({ password }) => !hasTriple(password),
  },
  {
    id: "season",
    code: "16",
    category: "CALENDAR",
    title: "季节限定",
    text: "密码必须包含一个季节汉字：<b>春</b>、<b>夏</b>、<b>秋</b> 或 <b>冬</b>。",
    hint: "任选一个字放进去。季节由你决定。",
    test: ({ password }) => SEASONS.some((season) => password.includes(season)),
  },
  {
    id: "knight",
    code: "17",
    category: "TACTICS",
    title: "骑士抓虫",
    text: "马在 a2，甲虫藏在别处。用一步「日」字走法抓住它，再把它的坐标写进密码。",
    hint: "骑士一步能到达三个格子。点中甲虫后，把显示的坐标（形如 b4）抄进密码。",
    challenge: "knight",
    test: ({ knightSolved, password }) => knightSolved && password.includes("c3"),
  },
  {
    id: "fire-skull",
    code: "18",
    category: "DRAMA",
    title: "火与骷髅",
    text: "密码里需要 <code>🔥</code> 和 <code>💀</code>，而且火必须在骷髅前面。",
    hint: "先放 🔥，隔几个字符，再放 💀。",
    test: ({ password }) => password.includes("🔥") && password.includes("💀") && password.indexOf("🔥") < password.indexOf("💀"),
  },
  {
    id: "ending",
    code: "19",
    category: "FORMAT",
    title: "问号收尾",
    text: "密码的最后一个字符必须是英文问号 <code>?</code>。表示你还在提问。",
    hint: "在密码最后打一个 ?。后面不能有任何字符或空格。",
    test: ({ password }) => password.endsWith("?"),
  },
  {
    id: "blacklist",
    code: "20",
    category: "SECURITY",
    title: "黑名单",
    text: "密码不能包含 <code>admin</code>、<code>root</code> 或 <code>123</code>（不区分大小写）。",
    hint: "避开这三个常见词。它们正在门外排队。",
    test: ({ password }) => !/admin|root|123/i.test(password),
  },
  {
    id: "exact-42",
    code: "21",
    category: "FINAL AUDIT",
    title: "正好四十二",
    text: "最终检查：密码必须正好 <b>42</b> 个字符。表情按 1 个字符计算，空格也算。",
    hint: "看着字符计数器凑到 42。多一个少一个都不行。",
    live: "exact",
    final: true,
    test: ({ chars }) => chars.length === 42,
  },
];

export const RULE_INDEX = new Map(RULES.map((rule, index) => [rule.id, index]));

if (RULES.length !== TOTAL_RULES) {
  throw new Error("TOTAL_RULES does not match the rule table");
}

/**
 * Returns whether a rule is settled, and whether it was settled by an
 * amendment rather than by its own condition.
 */
export function resolveRule(rule, context, activeIds) {
  if (rule.retiredBy && activeIds.has(rule.retiredBy)) {
    return { passed: true, retired: true };
  }
  return { passed: Boolean(rule.test(context)), retired: false };
}

export function activeRuleIds(activeCount) {
  return new Set(RULES.slice(0, activeCount).map((rule) => rule.id));
}

export const REFERENCE_SOLUTION = "mangoIVAu喵🐱春c3🔥💀987654xyzkxyzkxyzkxyzqwx!?";
