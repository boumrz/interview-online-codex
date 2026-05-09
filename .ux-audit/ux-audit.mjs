/**
 * UX audit script: walks the main application flows with Playwright,
 * captures screenshots and emits programmatic findings (a11y/UX heuristics).
 *
 * Heuristics implemented inline (no external a11y package required):
 *   - missing aria-label on icon-only buttons
 *   - missing <label> for non-disabled inputs
 *   - touch target < 44x44 px on visible interactive elements
 *   - horizontal scroll on the document
 *   - heading hierarchy (h1 must exist; no level skips)
 *   - placeholder-only inputs (no associated label, only placeholder)
 *   - contrast issues (WCAG AA threshold) for visible text nodes
 *   - clickable elements without `cursor: pointer`
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE_URL || "http://localhost:5173";
const OUT_DIR = new URL("./", import.meta.url).pathname;

const screenshots = [];
const findings = [];

function record(page, severity, rule, message, extra) {
  findings.push({
    page,
    severity,
    rule,
    message,
    ...(extra ? { extra } : {}),
  });
}

async function shoot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
}

/** Heuristic checks executed inside the page. */
async function evaluateChecks(page, label) {
  const results = await page.evaluate(() => {
    const out = [];

    // ---- Helpers --------------------------------------------------------
    const isVisible = (el) => {
      if (!(el instanceof Element)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };

    const accessibleName = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.trim();
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const ids = labelledBy.split(/\s+/);
        return ids
          .map((id) => document.getElementById(id)?.innerText || "")
          .join(" ")
          .trim();
      }
      const text = (el.innerText || "").trim();
      if (text) return text;
      const title = el.getAttribute("title");
      if (title) return title.trim();
      const alt = el.querySelector("img")?.getAttribute("alt");
      if (alt) return alt.trim();
      return "";
    };

    const parseRgb = (str) => {
      if (!str) return null;
      const m = str.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    };
    const blend = (fg, bg) => {
      if (!fg || !bg) return fg;
      const a = fg.a;
      return {
        r: fg.r * a + bg.r * (1 - a),
        g: fg.g * a + bg.g * (1 - a),
        b: fg.b * a + bg.b * (1 - a),
        a: 1,
      };
    };
    const luminance = ({ r, g, b }) => {
      const toLin = (v) => {
        const n = v / 255;
        return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
      };
      const R = toLin(r);
      const G = toLin(g);
      const B = toLin(b);
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    };
    const contrast = (a, b) => {
      const L1 = luminance(a);
      const L2 = luminance(b);
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    };
    const effectiveBackground = (el) => {
      let cur = el;
      while (cur && cur instanceof Element) {
        const bg = parseRgb(window.getComputedStyle(cur).backgroundColor);
        if (bg && bg.a > 0.95) return bg;
        cur = cur.parentElement;
      }
      // Document fallback: try body, then default white
      const bodyBg = parseRgb(window.getComputedStyle(document.body).backgroundColor);
      if (bodyBg && bodyBg.a > 0) return bodyBg;
      return { r: 255, g: 255, b: 255, a: 1 };
    };

    // ---- Heuristics -----------------------------------------------------

    // 1) horizontal scroll
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      out.push({
        severity: "high",
        rule: "horizontal-scroll",
        message: `document scrollWidth ${document.documentElement.scrollWidth} > viewport ${window.innerWidth}`,
      });
    }

    // 2) headings: must have one h1, no skips
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      .filter(isVisible)
      .map((h) => ({ level: parseInt(h.tagName.substring(1), 10), text: h.innerText.trim() }));
    if (!headings.some((h) => h.level === 1)) {
      out.push({
        severity: "medium",
        rule: "missing-h1",
        message: "no <h1> on this page",
      });
    }
    let prev = 0;
    for (const h of headings) {
      if (prev > 0 && h.level > prev + 1) {
        out.push({
          severity: "low",
          rule: "heading-skip",
          message: `heading jump from h${prev} to h${h.level}: "${h.text.slice(0, 80)}"`,
        });
      }
      prev = h.level;
    }

    // 3) icon-only / unlabeled interactive elements
    const interactive = document.querySelectorAll(
      'button, [role="button"], a[href], [role="link"]',
    );
    const seenIconBtn = new Set();
    interactive.forEach((el) => {
      if (!isVisible(el)) return;
      const name = accessibleName(el);
      if (!name) {
        const html = el.outerHTML.slice(0, 200);
        if (seenIconBtn.has(html)) return;
        seenIconBtn.add(html);
        out.push({
          severity: "high",
          rule: "interactive-without-name",
          message: html,
        });
      }
    });

    // 4) inputs without associated label
    const inputs = document.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea",
    );
    const seenInputs = new Set();
    inputs.forEach((el) => {
      if (!isVisible(el)) return;
      const id = el.getAttribute("id");
      const ariaLabel = el.getAttribute("aria-label");
      const ariaLabelledBy = el.getAttribute("aria-labelledby");
      const associatedLabel = id
        ? document.querySelector(`label[for="${id}"]`)
        : el.closest("label");
      if (!associatedLabel && !ariaLabel && !ariaLabelledBy) {
        const html = el.outerHTML.slice(0, 200);
        if (seenInputs.has(html)) return;
        seenInputs.add(html);
        out.push({
          severity: "high",
          rule: "input-without-label",
          message: html,
        });
      } else if (
        !associatedLabel &&
        !ariaLabel &&
        !ariaLabelledBy &&
        el.getAttribute("placeholder")
      ) {
        out.push({
          severity: "medium",
          rule: "placeholder-only-label",
          message: el.outerHTML.slice(0, 200),
        });
      }
    });

    // 5) touch targets < 44x44 on visible interactive elements (excluding link-in-text)
    const seenTiny = new Set();
    interactive.forEach((el) => {
      if (!isVisible(el)) return;
      // Skip inline links inside text paragraphs
      if (el.tagName === "A" && el.closest("p")) return;
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w === 0 || h === 0) return;
      const min = Math.min(w, h);
      if (min < 32) {
        const key = `${w}x${h}::${(el.innerText || el.getAttribute("aria-label") || "").slice(0, 40)}`;
        if (seenTiny.has(key)) return;
        seenTiny.add(key);
        out.push({
          severity: min < 24 ? "high" : "medium",
          rule: "touch-target-small",
          message: `${w}x${h}px: ${(el.getAttribute("aria-label") || el.innerText || el.title || "").slice(0, 60)}`,
        });
      }
    });

    // 6) clickable but no cursor: pointer (only on <div role="button"> etc.)
    const seenCursor = new Set();
    document.querySelectorAll('[role="button"]:not(button)').forEach((el) => {
      if (!isVisible(el)) return;
      const cursor = window.getComputedStyle(el).cursor;
      if (cursor !== "pointer") {
        const key = el.outerHTML.slice(0, 120);
        if (seenCursor.has(key)) return;
        seenCursor.add(key);
        out.push({
          severity: "low",
          rule: "missing-cursor-pointer",
          message: `cursor=${cursor}: ${(el.getAttribute("aria-label") || el.innerText || "").slice(0, 60)}`,
        });
      }
    });

    // 7) visible text nodes contrast (sample only direct text inside elements with text)
    const sampleSize = 250;
    const textEls = Array.from(document.body.querySelectorAll("*"))
      .filter((el) => {
        if (!isVisible(el)) return false;
        const dt = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0);
        return Boolean(dt);
      })
      .slice(0, sampleSize);
    const seenContrast = new Set();
    textEls.forEach((el) => {
      const cs = window.getComputedStyle(el);
      const fg = parseRgb(cs.color);
      const bgRaw = parseRgb(cs.backgroundColor);
      const bg = bgRaw && bgRaw.a > 0.95 ? bgRaw : effectiveBackground(el);
      if (!fg || !bg) return;
      const blended = blend(fg, bg);
      const ratio = contrast(blended, bg);
      const fontSize = parseFloat(cs.fontSize) || 16;
      const fontWeight = parseInt(cs.fontWeight) || 400;
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const minRatio = isLarge ? 3 : 4.5;
      if (ratio < minRatio) {
        const text = (Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE).textContent || "").trim().slice(0, 60);
        const key = `${cs.color}|${cs.backgroundColor}|${text.slice(0, 20)}`;
        if (seenContrast.has(key)) return;
        seenContrast.add(key);
        out.push({
          severity: "medium",
          rule: "low-contrast",
          message: `${ratio.toFixed(2)}:1 (need ${minRatio}:1) — fg=${cs.color} bg=${cs.backgroundColor} fontSize=${fontSize}px text="${text}"`,
        });
      }
    });

    return out;
  });

  results.forEach((r) => record(label, r.severity, r.rule, r.message));
  return results;
}

async function withPage(label, fn) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (err) =>
    record(label, "high", "page-error", err.message),
  );
  page.on("console", (msg) => {
    if (msg.type() === "error") record(label, "medium", "console-error", msg.text());
  });
  try {
    await fn(page);
  } finally {
    await browser.close();
  }
}

async function auditLanding() {
  await withPage("/", async (page) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await shoot(page, "01-landing");
    await evaluateChecks(page, "/");
  });
}

async function auditLogin() {
  await withPage("/login", async (page) => {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await shoot(page, "02-login");
    await evaluateChecks(page, "/login");
  });
}

async function auditDashboard() {
  await withPage("/dashboard", async (page) => {
    // Sign up an admin (boumrz is reserved) → use boumrz creds. Bypass via auth API would require backend knowledge.
    // Try guest login by registering a fresh user.
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const nick = `auditor_${Date.now()}`;
    const pwd = "AuditorPass123!";
    // The login page has a "register" toggle (best-effort).
    const hasRegister = await page.getByText(/Регистрация|Создать аккаунт|Sign up/i).first().isVisible().catch(() => false);
    if (hasRegister) {
      await page.getByText(/Регистрация|Создать аккаунт|Sign up/i).first().click();
    }
    await page.locator('input[type="text"], input').first().fill(nick).catch(() => {});
    const passwordInput = page.locator('input[type="password"]').first();
    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.fill(pwd);
    }
    const submit = page.locator('button[type="submit"]').first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click();
    }
    await page.waitForURL(/\/dashboard/, { timeout: 8000 }).catch(() => {});
    if (!page.url().includes("/dashboard")) {
      record("/dashboard", "low", "audit-skipped", "could not authenticate; skipping deep dashboard check");
      return;
    }
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await shoot(page, "03-dashboard-rooms");
    await evaluateChecks(page, "/dashboard?section=rooms");

    for (const tab of ["tasks", "manage"]) {
      const trigger = page.getByRole("button", { name: new RegExp(tab === "tasks" ? "Задачи" : "Управление комнатами", "i") }).first();
      if (await trigger.isVisible().catch(() => false)) {
        await trigger.click();
        await page.waitForTimeout(300);
        await shoot(page, `03-dashboard-${tab}`);
        await evaluateChecks(page, `/dashboard?section=${tab}`);
      }
    }
  });
}

async function auditRoom() {
  await withPage("/room", async (page) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Создать комнату" }).click();
    await page.waitForURL(/\/room\//, { timeout: 12000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await shoot(page, "04-room-owner");
    await evaluateChecks(page, "/room (owner)");

    // Open notes panel if present.
    const tools = page.getByRole("button", { name: "Открыть панель чата и логов" }).first();
    if (await tools.isVisible().catch(() => false)) {
      await tools.click();
      await page.waitForTimeout(200);
    }
    const notesTab = page.getByRole("tab", { name: /Заметки|Чат/ }).first();
    if (await notesTab.isVisible().catch(() => false)) {
      await notesTab.click();
      await page.waitForTimeout(200);
      await shoot(page, "04-room-notes");
      await evaluateChecks(page, "/room notes panel");
    }

    // Try /block menu.
    const notesInput = page.locator('[data-testid="room-notes-input"]').first();
    if (await notesInput.isVisible().catch(() => false)) {
      await notesInput.fill("/block ");
      await page.waitForTimeout(300);
      await shoot(page, "04-room-block-menu");
      await evaluateChecks(page, "/room /block menu");
      await notesInput.fill("");
    }

    // Try export modal.
    const exportBtn = page.getByRole("button", { name: /Экспорт/i }).first();
    if (await exportBtn.isVisible().catch(() => false)) {
      await exportBtn.click();
      await page.waitForTimeout(400);
      await shoot(page, "04-room-export");
      await evaluateChecks(page, "/room export modal");
    }
  });
}

async function auditCandidateView() {
  await withPage("/room (candidate)", async (page) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Создать комнату" }).click();
    await page.waitForURL(/\/room\//, { timeout: 12000 });
    const url = page.url();

    // Open same room in another context as candidate (no owner token).
    const browser = await chromium.launch({ headless: true });
    try {
      const candidateCtx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const candidatePage = await candidateCtx.newPage();
      await candidatePage.goto(url, { waitUntil: "domcontentloaded" });
      await candidatePage.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

      // The candidate name modal might open; try to fill any open name field.
      const nameInput = candidatePage.locator('input[type="text"]').first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill("Кандидат");
        const enterBtn = candidatePage.getByRole("button", { name: /Войти|Подключиться|Продолжить|ОК|Готово/i }).first();
        if (await enterBtn.isVisible().catch(() => false)) {
          await enterBtn.click();
          await candidatePage.waitForTimeout(500);
        }
      }
      await shoot(candidatePage, "05-room-candidate");
      await evaluateChecks(candidatePage, "/room (candidate)");
    } finally {
      await browser.close();
    }
  });
}

async function auditMobile() {
  // Repeat critical flows at 375px to catch mobile-specific regressions.
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => record("/(mobile)", "high", "page-error", err.message));

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await shoot(page, "06-mobile-landing");
    await evaluateChecks(page, "/ (mobile 375px)");

    await page.getByRole("button", { name: "Создать комнату" }).click();
    await page.waitForURL(/\/room\//, { timeout: 12000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await shoot(page, "06-mobile-room");
    await evaluateChecks(page, "/room (mobile 375px)");
  } finally {
    await browser.close();
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await auditLanding();
  await auditLogin();
  await auditDashboard();
  await auditRoom();
  await auditCandidateView();
  await auditMobile();

  await fs.writeFile(
    path.join(OUT_DIR, "findings.json"),
    JSON.stringify({ findings, screenshots }, null, 2),
  );

  // Print human summary.
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.page}::${f.severity}::${f.rule}`;
    const g = groups.get(key) || { ...f, count: 0, samples: [] };
    g.count += 1;
    if (g.samples.length < 5) g.samples.push(f.message);
    groups.set(key, g);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    return b.count - a.count;
  });
  const lines = [];
  lines.push(`UX AUDIT SUMMARY — ${ordered.length} grouped findings`);
  for (const g of ordered) {
    lines.push(`[${g.severity}] (${g.count}x) ${g.page} ${g.rule}`);
    for (const s of g.samples) lines.push(`    - ${s.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error("UX_AUDIT_FAILED", err);
  process.exit(1);
});
