// Build-time SEO prerender for the landing page.
//
// The app is a client-side React SPA, so the built index.html used to contain only an
// empty <div id="root">. Search engines and link previews saw a title and no text.
//
// This plugin reads the English landing copy straight from NexusLanding.tsx (the COPY
// object) and writes a plain-HTML version of the hero, "How a trade works", "What you
// need" and the FAQ inside #root. React replaces it on first render, so visitors see the
// normal app; crawlers and no-JS readers see the same words the app shows. Because it is
// generated from COPY at every build, it can never drift from the live copy.
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

type Pair = [string, string];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function readEnglishCopy(root: string) {
  const file = path.join(root, "src/components/NexusLanding.tsx");
  const src = fs.readFileSync(file, "utf8");
  const marker = "const COPY: Record<Lang, Copy> = ";
  const start = src.indexOf(marker);
  if (start < 0) throw new Error("landing-prerender: COPY object not found in NexusLanding.tsx");
  let i = start + marker.length;
  let depth = 0;
  let inString = false;
  let end = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("landing-prerender: could not find the end of COPY");
  const copy = JSON.parse(src.slice(start + marker.length, end + 1));
  return copy.en;
}

function renderLanding(t: ReturnType<typeof readEnglishCopy>) {
  const list = (items: Pair[]) =>
    items.map(([h, p]) => `<li><strong>${esc(h)}</strong> ${esc(p)}</li>`).join("");
  const faq = (items: Pair[]) =>
    items.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("");
  return [
    `<main class="seo-prerender">`,
    `<h1>${esc(t.hero.h1)}</h1>`,
    `<p>${esc(t.hero.p)}</p>`,
    `<p>${esc(t.hero.note)}</p>`,
    `<h2>${esc(t.how.h2)}</h2><p>${esc(t.how.p)}</p><ol>${list(t.how.steps)}</ol>`,
    `<h3>${esc(t.how.deadlineH)}</h3><p>${esc(t.how.deadlineP)}</p>`,
    `<h3>${esc(t.how.wrongH)}</h3><p>${esc(t.how.wrongP)}</p>`,
    `<h2>${esc(t.need.h2)}</h2><p>${esc(t.need.p)}</p><ul>${list(t.need.items)}</ul>`,
    `<h2>${esc(t.practice.h2)}</h2><p>${esc(t.practice.p)}</p>`,
    `<h2>${esc(t.faq.h2)}</h2>${faq(t.faq.items)}`,
    `<p>${esc(t.start.questionsPre)}<a href="https://t.me/KadenaNexus">${esc(t.start.tg)}</a>${esc(t.start.questionsPost)}</p>`,
    `<p><a href="https://kadena.ws/">Part of Kadena Nexus</a></p>`,
    `</main>`,
  ].join("");
}

export function landingPrerender(): Plugin {
  let root = process.cwd();
  return {
    name: "kadena-nexus-landing-prerender",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml(html) {
      const target = '<div id="root"></div>';
      if (!html.includes(target)) throw new Error("landing-prerender: empty #root not found in index.html");
      return html.replace(target, `<div id="root">${renderLanding(readEnglishCopy(root))}</div>`);
    },
  };
}
