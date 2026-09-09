// Screenshot every route at the widths that actually matter, so responsive
// claims can be checked rather than asserted.
//
// Also fails loudly on horizontal overflow — the single most common responsive
// bug, and one that is invisible in a screenshot because the viewport crops it.
//
//   node scripts/shoot.mjs [baseUrl] [outDir]

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const OUT = process.argv[3] ?? "screenshots";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 }, // iPhone 14/15
  { name: "tablet", width: 834, height: 1112 }, // iPad Air portrait
  { name: "desktop", width: 1440, height: 900 },
  { name: "wide", width: 1920, height: 1080 },
];

const ROUTES = [
  { name: "tailor", path: "/" },
  { name: "build", path: "/build" },
  { name: "profile", path: "/profile" },
];

const browser = await chromium.launch();
const problems = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  for (const route of ROUTES) {
    mkdirSync(OUT, { recursive: true });
    // domcontentloaded + an explicit font wait: networkidle can hang forever
    // on a page that keeps a connection open.
    await page.goto(BASE + route.path, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    // Let the one page-load animation settle before capturing.
    await page.waitForTimeout(900);

    const file = join(OUT, `${route.name}-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true });

    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return {
        scrollW: d.scrollWidth,
        clientW: d.clientWidth,
        // Name the widest offenders so a failure is actionable.
        culprits: [...document.querySelectorAll("*")]
          .filter((el) => el.getBoundingClientRect().right > d.clientWidth + 1)
          .slice(0, 5)
          .map((el) => {
            const c =
              typeof el.className === "string" ? el.className.slice(0, 60) : "";
            return `${el.tagName.toLowerCase()}${c ? "." + c : ""}`;
          }),
      };
    });

    // Contrast audit. Reading screenshots catches only what I happen to look
    // at; this catches every visible text node. WCAG AA is 4.5:1 for body text
    // and 3:1 for large text (>=18.66px bold or >=24px).
    const lowContrast = await page.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb.map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const parse = (s) =>
        (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
      const opaqueBg = (el) => {
        for (let n = el; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          const p = parse(bg);
          const alpha = bg.startsWith("rgba") ? Number(bg.split(",")[3]) : 1;
          if (p.length === 3 && alpha > 0.85) return p;
        }
        return [16, 14, 12];
      };
      const out = [];
      for (const el of document.querySelectorAll("*")) {
        const text = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join(" ");
        if (!text) continue;
        const st = getComputedStyle(el);
        if (st.visibility === "hidden" || st.display === "none") continue;
        if (el.getBoundingClientRect().width === 0) continue;
        const fg = parse(st.color);
        if (fg.length !== 3) continue;
        const L1 = lum(fg) + 0.05;
        const L2 = lum(opaqueBg(el)) + 0.05;
        const ratio = Math.max(L1, L2) / Math.min(L1, L2);
        const px = parseFloat(st.fontSize);
        const large = px >= 24 || (px >= 18.66 && Number(st.fontWeight) >= 700);
        const need = large ? 3 : 4.5;
        if (ratio < need) {
          out.push(
            `${ratio.toFixed(2)}:1 (need ${need}) "${text.slice(0, 45)}"`,
          );
        }
      }
      return [...new Set(out)].slice(0, 6);
    });

    for (const c of lowContrast) {
      problems.push(`${route.name} @ ${vp.width}px low contrast — ${c}`);
    }

    if (overflow.scrollW > overflow.clientW + 1) {
      problems.push(
        `${route.name} @ ${vp.width}px overflows by ${overflow.scrollW - overflow.clientW}px` +
          (overflow.culprits.length
            ? ` — ${overflow.culprits.join(", ")}`
            : ""),
      );
    }
    console.log(`  ${file}  (${overflow.scrollW}px wide)`);
  }
  await ctx.close();
}

await browser.close();

if (problems.length) {
  console.error("\nHORIZONTAL OVERFLOW:");
  for (const p of problems) console.error("  " + p);
  process.exitCode = 1;
} else {
  console.log("\nNo horizontal overflow at any width.");
}
