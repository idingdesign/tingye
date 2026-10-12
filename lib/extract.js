/**
 * DOM extraction helpers shared by content script.
 * Modes: article (main text) / elements (buttons etc.) / all
 */
(function (global) {
  "use strict";

  const INTERACTIVE_SEL =
    "button, [role='button'], input, select, textarea, nav, aside, footer, header, form," +
    "[role='navigation'], [role='banner'], [role='contentinfo'], [role='complementary']," +
    "script, style, noscript, template, svg, iframe," +
    ".btn, .button, .nav, .navbar, .menu, .sidebar, .footer, .header," +
    ".ads, .advertisement, .cookie, .modal, .share, .social, .toolbar, .pagination";

  const SKIP_LINK_SEL =
    "a.skip-link, a.skip-to-content, a.skip-to-main, a[href='#content'], a[href='#main']," +
    "a[href='#main-content'], a[href='#primary'], a[href='#app'], a[href='#root']," +
    "[class*='skip-link'], [class*='skipLink'], [class*='skip-to'], [id*='skip-link']," +
    "[id*='skipLink'], [data-testid*='skip']";

  const SKIP_TEXT_RE =
    /^(跳至内容|跳到内容|跳过导航|跳至主要內容|跳到主要內容|Skip to content|Skip to main content|Skip to main|Skip navigation|Skip to navigation)\s*/i;

  function normalizeSpace(s) {
    return (s || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function stripSkipNoise(s) {
    let t = normalizeSpace(s);
    // May appear glued to following text with no space (e.g. skip-link text glued to the next word)
    for (let i = 0; i < 3; i++) {
      const next = t.replace(SKIP_TEXT_RE, "");
      if (next === t) break;
      t = next.trim();
    }
    return t;
  }

  function isVisibleLike(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "noscript", "template", "svg", "iframe"].includes(tag)) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    if (node.hasAttribute("hidden")) return false;
    try {
      const st = getComputedStyle(node);
      if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
    } catch (_) {
      const style = node.getAttribute("style") || "";
      if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return false;
    }
    return true;
  }

  function textOf(node) {
    return normalizeSpace(node?.innerText || node?.textContent || "");
  }

  function isSkipLink(el) {
    if (!el || el.tagName !== "A") return false;
    const href = (el.getAttribute("href") || "").trim();
    const cls = String(el.className || "");
    const id = String(el.id || "");
    const label = normalizeSpace(el.textContent || el.getAttribute("aria-label") || "");
    if (/skip/i.test(cls) || /skip/i.test(id)) return true;
    if (/^#(content|main|main-content|primary|app|root|page|wrapper)$/i.test(href) && label.length < 40) {
      if (SKIP_TEXT_RE.test(label) || /skip/i.test(label)) return true;
    }
    if (SKIP_TEXT_RE.test(label) && label.length < 40) return true;
    return false;
  }

  /**
   * Clone a node and strip interactive / chrome / skip-links so article text
   * does not include buttons, form controls, nav chrome, etc.
   * Keep in-content links' text (href destinations stay as readable words).
   */
  function articlePlainText(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone.querySelectorAll(SKIP_LINK_SEL).forEach((el) => el.remove());
    clone.querySelectorAll("a[href^='#']").forEach((a) => {
      if (isSkipLink(a)) a.remove();
    });
    clone.querySelectorAll(INTERACTIVE_SEL).forEach((el) => el.remove());
    // Also drop any remaining short skip-link-like anchors by text
    clone.querySelectorAll("a").forEach((a) => {
      const t = normalizeSpace(a.textContent || "");
      if (!t) {
        a.remove();
        return;
      }
      if (isSkipLink(a) || SKIP_TEXT_RE.test(t)) a.remove();
    });
    return stripSkipNoise(normalizeSpace(clone.innerText || clone.textContent || ""));
  }

  function pickArticleRoot(doc) {
    const body = doc.body;
    if (!body) return null;
    const preferredSel =
      "article, main, [role='main'], .post, .post-content, .entry-content, .article-content, .content, #content, #main, #main-content";
    const preferred = body.querySelectorAll(preferredSel);
    let best = null;
    let bestScore = -1;
    preferred.forEach((n) => {
      if (!isVisibleLike(n)) return;
      // Prefer real article/main over generic .content wrappers that wrap the whole page
      const tag = n.tagName.toLowerCase();
      const role = (n.getAttribute("role") || "").toLowerCase();
      const t = articlePlainText(n);
      if (t.length < 40) return;
      let score = t.length;
      if (tag === "article") score += 2000;
      else if (tag === "main" || role === "main") score += 1500;
      else score += 500;
      // Penalize nodes that still look like they wrap site chrome
      if (n.querySelector("header, [role='banner'], nav, [role='navigation']")) score -= 200;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    });
    return best;
  }

  function extractArticle(doc) {
    const body = doc.body;
    if (!body) return { text: "", targets: [] };

    const removeSel = INTERACTIVE_SEL;
    const preferredRoot = pickArticleRoot(doc);
    const candidates = [];

    if (preferredRoot) {
      const t = articlePlainText(preferredRoot);
      if (t.length > 40) {
        const tag = preferredRoot.tagName.toLowerCase();
        const role = (preferredRoot.getAttribute("role") || "").toLowerCase();
        let score = t.length + 800;
        if (tag === "article") score += 2000;
        else if (tag === "main" || role === "main") score += 1500;
        candidates.push({ n: preferredRoot, score, t });
      }
    }

    // Also scan preferred selectors individually (in case pickArticleRoot missed a better article)
    body
      .querySelectorAll(
        "article, main, [role='main'], .post, .post-content, .entry-content, .article-content, .content, #content, #main, #main-content"
      )
      .forEach((n) => {
        if (!isVisibleLike(n)) return;
        if (preferredRoot && n === preferredRoot) return;
        const t = articlePlainText(n);
        if (t.length > 80) {
          const tag = n.tagName.toLowerCase();
          const role = (n.getAttribute("role") || "").toLowerCase();
          let bonus = 500;
          if (tag === "article") bonus = 2000;
          else if (tag === "main" || role === "main") bonus = 1500;
          candidates.push({ n, score: t.length + bonus, t });
        }
      });

    body.querySelectorAll("div,section").forEach((n) => {
      if (!isVisibleLike(n)) return;
      if (n.matches(removeSel) || n.closest(removeSel)) return;
      if (n.closest("header, nav, [role='banner'], [role='navigation'], aside, footer")) return;
      const t = articlePlainText(n);
      if (t.length < 120) return;
      const pCount = n.querySelectorAll("p").length;
      const hCount = n.querySelectorAll("h1, h2").length;
      const clone = n.cloneNode(true);
      clone.querySelectorAll(SKIP_LINK_SEL).forEach((el) => el.remove());
      clone
        .querySelectorAll("button, [role='button'], input, select, textarea, nav, aside, footer, header")
        .forEach((el) => el.remove());
      const plain = normalizeSpace(clone.innerText || "");
      const linkLen = Array.from(clone.querySelectorAll("a")).reduce(
        (s, a) => s + normalizeSpace(a.textContent || "").length,
        0
      );
      const linkRatio = plain.length ? linkLen / plain.length : 1;
      let score = t.length + pCount * 40 + hCount * 60 - linkRatio * 200;
      if (/comment|sidebar|related|share|social/i.test((n.className || "") + (n.id || ""))) score -= 300;
      candidates.push({ n, score, t });
    });

    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length) {
      return { text: stripSkipNoise(candidates[0].t), targets: [candidates[0].n] };
    }
    return { text: stripSkipNoise(articlePlainText(body)), targets: [body] };
  }

  function K(key, fb) {
    try { return (chrome && chrome.i18n && chrome.i18n.getMessage(key)) || fb; } catch (_) { return fb; }
  }

  function extractElements(doc) {
    const root = doc.body || doc.documentElement;
    if (!root) return { items: [], targets: [] };
    const items = [];
    const targets = [];
    const seen = new Set();

    const push = (kind, text, node) => {
      const t = normalizeSpace(text);
      if (!t || t.length > 300) return;
      const key = kind + "::" + t;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ kind, text: t });
      targets.push(node);
    };

    root
      .querySelectorAll(
        "button, [role='button'], a, input, textarea, select, label, summary, [role='link'], [role='menuitem'], [role='tab'], [role='option']"
      )
      .forEach((node) => {
        if (!isVisibleLike(node)) return;
        if (isSkipLink(node)) return;
        const tag = node.tagName.toLowerCase();
        if (tag === "a") {
          push(K("kLink","Link"), textOf(node) || node.getAttribute("aria-label") || node.getAttribute("title"), node);
          return;
        }
        if (tag === "button" || node.getAttribute("role") === "button") {
          push(
            K("kButton","Button"),
            textOf(node) ||
              node.getAttribute("aria-label") ||
              node.getAttribute("title") ||
              node.getAttribute("value"),
            node
          );
          return;
        }
        if (tag === "input") {
          const type = (node.getAttribute("type") || "text").toLowerCase();
          push(
            K("kInput","Input"),
            node.getAttribute("aria-label") ||
              node.getAttribute("placeholder") ||
              node.getAttribute("value") ||
              node.getAttribute("name") ||
              type,
            node
          );
          return;
        }
        if (tag === "textarea") {
          push(K("kInput","Input"), node.getAttribute("aria-label") || node.getAttribute("placeholder") || K("kTextbox","Text box"), node);
          return;
        }
        if (tag === "select") {
          const label = node.getAttribute("aria-label") || node.getAttribute("name") || K("kDropdown","Dropdown");
          push(K("kSelect","Select"), label, node);
          node.querySelectorAll("option").forEach((opt) => push(K("kOption","Option"), textOf(opt) || opt.value, opt));
          return;
        }
        if (tag === "label" || tag === "summary") {
          push(tag === "label" ? K("kLabel","Label") : K("kSummary","Summary"), textOf(node), node);
          return;
        }
        push(K("kControl","Control"), textOf(node) || node.getAttribute("aria-label"), node);
      });

    return { items, targets };
  }

  function extractAll(doc) {
    const root = doc.body || doc.documentElement;
    if (!root) return { text: "", targets: [] };
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName.toLowerCase();
        if (["script", "style", "noscript", "template"].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (!isVisibleLike(p)) return NodeFilter.FILTER_REJECT;
        if (p.closest("header, nav, [role='banner'], [role='navigation']")) return NodeFilter.FILTER_REJECT;
        if (isSkipLink(p) || (p.closest("a") && isSkipLink(p.closest("a")))) return NodeFilter.FILTER_REJECT;
        if (!normalizeSpace(node.textContent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const parts = [];
    let n;
    while ((n = walker.nextNode())) {
      const t = stripSkipNoise(normalizeSpace(n.textContent));
      if (t) parts.push(t);
    }
    return { text: parts.join("\n"), targets: [root] };
  }

  function splitIntoChunks(text, maxLen = 180) {
    const cleaned = stripSkipNoise(normalizeSpace(text)).replace(/\n+/g, " ");
    if (!cleaned) return [];
    const rough = cleaned.split(/(?<=[。！？；.!?;…])\s*/);
    const out = [];
    for (let part of rough) {
      part = stripSkipNoise(part.trim());
      if (!part) continue;
      if (part.length <= maxLen) {
        out.push(part);
        continue;
      }
      let buf = "";
      const pieces = part.split(/(?<=[，,、：:]\s*)|(?=\s+)/);
      for (const piece of pieces) {
        if (!piece) continue;
        if ((buf + piece).length > maxLen) {
          if (buf.trim()) out.push(stripSkipNoise(buf.trim()));
          if (piece.length > maxLen) {
            for (let i = 0; i < piece.length; i += maxLen) {
              const slice = stripSkipNoise(piece.slice(i, i + maxLen).trim());
              if (slice) out.push(slice);
            }
            buf = "";
          } else {
            buf = piece;
          }
        } else {
          buf += piece;
        }
      }
      if (buf.trim()) out.push(stripSkipNoise(buf.trim()));
    }
    return out.filter(Boolean);
  }

  /**
   * @param {"article"|"elements"|"all"} area
   * @returns {{chunks:string[], kinds?:string[], meta:{title:string,url:string}}}
   */
  function extractPage(area) {
    const doc = document;
    const meta = { title: doc.title || "", url: location.href };
    if (area === "elements") {
      const { items } = extractElements(doc);
      return {
        chunks: items.map((it) => `${it.kind}：${it.text}`),
        kinds: items.map((it) => it.kind),
        texts: items.map((it) => it.text),
        meta,
      };
    }
    if (area === "all") {
      const { text } = extractAll(doc);
      return { chunks: splitIntoChunks(text), meta };
    }
    const { text } = extractArticle(doc);
    return { chunks: splitIntoChunks(text), meta };
  }

  global.IdingExtract = {
    normalizeSpace,
    stripSkipNoise,
    extractArticle,
    extractElements,
    extractAll,
    splitIntoChunks,
    extractPage,
    isVisibleLike,
    textOf,
    articlePlainText,
    isSkipLink,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
