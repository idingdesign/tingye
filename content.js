/**
 * Content script: extract & highlight on the current page.
 */
(function () {
  "use strict";
  if (window.__idingReaderContent) return;
  window.__idingReaderContent = true;

  let lastTargets = [];
  let lastChunks = [];
  let lastArea = "article";

  const CHROME_CLOSEST =
    "button, [role='button'], nav, aside, footer, form, script, style, noscript," +
    "header, [role='banner'], [role='navigation'], [role='contentinfo']";

  function clearHighlight() {
    document.querySelectorAll(".iding-reader-hl").forEach((n) => n.classList.remove("iding-reader-hl"));
  }

  function normalize(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanNeedle(chunk) {
    const raw = normalize(chunk);
    if (IdingExtract.stripSkipNoise) return normalize(IdingExtract.stripSkipNoise(raw));
    return raw;
  }

  function blockText(n, area) {
    if (area === "article" && IdingExtract.articlePlainText) {
      return normalize(IdingExtract.articlePlainText(n));
    }
    return normalize(IdingExtract.textOf(n));
  }

  function isChromeNode(n) {
    if (!n || n.nodeType !== 1) return true;
    const tag = n.tagName.toLowerCase();
    if (tag === "button") return true;
    if (n.getAttribute("role") === "button") return true;
    if (n.closest(CHROME_CLOSEST)) return true;
    if (tag === "a" && n.closest("header, nav, [role='banner'], [role='navigation']")) return true;
    if (IdingExtract.isSkipLink && IdingExtract.isSkipLink(n)) return true;
    if (tag === "a" && IdingExtract.isSkipLink && IdingExtract.isSkipLink(n)) return true;
    return false;
  }

  function inMainArticle(n) {
    return !!(n && n.closest && n.closest("article, main, [role='main']"));
  }

  function collectBlocks(area) {
    const rootInfo =
      area === "all"
        ? { targets: [document.body] }
        : area === "elements"
          ? null
          : IdingExtract.extractArticle(document);
    if (area === "elements") {
      const { targets } = IdingExtract.extractElements(document);
      return { root: document.body, blocks: targets.filter(Boolean) };
    }
    const root = rootInfo?.targets?.[0] || document.body;
    const blocks = Array.from(
      root.querySelectorAll("p, h1, h2, h3, h4, h5, li, blockquote, pre, td, th, figcaption, dd, section, article, div")
    ).filter((n) => {
      if (!IdingExtract.isVisibleLike(n)) return false;
      if (isChromeNode(n)) return false;
      // skip huge wrappers that contain many other blocks
      const kids = n.querySelectorAll("p, h1, h2, h3, h4, li").length;
      if (n.tagName === "DIV" && kids >= 2) return false;
      const t = blockText(n, area);
      if (!t.length) return false;
      // Drop tiny chrome-like leftovers (button labels glued into a div)
      if (t.length < 12 && /^(Contact|Try|Login|Sign|\u83dc\u5355|\u767b\u5f55)/i.test(t)) return false;
      return true;
    });
    return { root, blocks };
  }

  function tagBonus(n) {
    const tag = (n.tagName || "").toLowerCase();
    if (tag === "h1") return 400;
    if (tag === "h2") return 300;
    if (tag === "p") return 220;
    if (tag === "h3" || tag === "li" || tag === "blockquote") return 120;
    if (tag === "div" || tag === "section") return 0;
    return 40;
  }

  function findBestBlock(chunk, area) {
    const { root, blocks } = collectBlocks(area);
    if (area === "elements") {
      const needle = normalize(chunk.replace(/^[^：:]+[：:]/, ""));
      let best = blocks[0] || root;
      let bestScore = -1;
      for (const b of blocks) {
        const t = normalize(IdingExtract.textOf(b));
        let score = 0;
        if (t === needle) score = 2000;
        else if (t.includes(needle.slice(0, Math.min(20, needle.length)))) score = 1000;
        else if (needle.includes(t.slice(0, Math.min(16, t.length)))) score = 500;
        if (score > bestScore) {
          bestScore = score;
          best = b;
        }
      }
      return best;
    }

    const full = cleanNeedle(chunk);
    if (!full) return root;
    const needle = full.slice(0, Math.min(36, full.length));
    const short = full.slice(0, Math.min(12, full.length));
    let best = null;
    let bestScore = -1;
    const list = blocks.length ? blocks : [];

    for (const b of list) {
      if (isChromeNode(b)) continue;
      const t = blockText(b, area);
      if (!t) continue;

      let score = 0;
      const idx = t.indexOf(needle);
      if (idx >= 0) score = 2000 - Math.min(idx, 500);
      else if (short && t.indexOf(short) >= 0) score = 800 - Math.min(t.indexOf(short), 200);
      else if (needle.length >= 8 && t.includes(needle.slice(0, 8))) score = 200;
      else continue;

      // Prefer smaller/more specific content nodes
      if (score > 0) score += Math.max(0, 80 - Math.min(t.length / 20, 80));
      score += tagBonus(b);
      if (inMainArticle(b)) score += 250;

      // Short header-like labels must not beat long paragraphs
      if (t.length < 40) score -= 600;
      if (t.length < 20) score -= 400;
      // Long article paragraphs / headings get a length floor boost
      if (t.length >= 60) score += Math.min(120, t.length / 10);

      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }

    // Fallback: prefer first h1/h2/p inside main/article, never chrome
    if (!best || bestScore < 100) {
      const scope = root.querySelector("article, main, [role='main']") || root;
      const fallback =
        scope.querySelector("h1") ||
        scope.querySelector("h2") ||
        scope.querySelector("p") ||
        list.find((n) => !isChromeNode(n) && inMainArticle(n)) ||
        list.find((n) => !isChromeNode(n)) ||
        scope;
      if (fallback && !isChromeNode(fallback)) return fallback;
      return scope;
    }
    return best;
  }

  function softTargetsForChunks(chunks, area) {
    return chunks.map((chunk) => findBestBlock(chunk, area));
  }

  function rebuildTargetsIfNeeded() {
    if (!lastChunks.length) return;
    const needs =
      !lastTargets.length ||
      lastTargets.length !== lastChunks.length ||
      lastTargets.some((n) => !n || !n.isConnected);
    if (needs) {
      lastTargets = softTargetsForChunks(lastChunks, lastArea);
    }
  }

  function highlightIndex(i) {
    rebuildTargetsIfNeeded();
    clearHighlight();
    i = Number(i);
    if (!Number.isFinite(i) || i < 0) return { ok: false, reason: "bad-index" };

    let node = lastTargets[i];
    if (!node || !node.isConnected || isChromeNode(node)) {
      if (lastChunks[i]) {
        node = findBestBlock(lastChunks[i], lastArea);
        lastTargets[i] = node;
      }
    }
    if (!node || !node.isConnected) return { ok: false, reason: "no-node" };
    // Never paint chrome; re-resolve once more if somehow chrome
    if (isChromeNode(node) && lastChunks[i]) {
      node = findBestBlock(lastChunks[i], lastArea);
      lastTargets[i] = node;
    }
    if (!node || !node.isConnected || isChromeNode(node)) {
      const scope =
        document.querySelector("article, main, [role='main']") || document.body;
      node = scope.querySelector("h1, h2, p") || scope;
    }

    try {
      node.classList.add("iding-reader-hl");
      node.scrollIntoView({ block: "center", behavior: "smooth", inline: "nearest" });
      const r = node.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        window.scrollBy({ top: r.top - window.innerHeight * 0.3, behavior: "smooth" });
      }
      return { ok: true, tag: node.tagName };
    } catch (err) {
      return { ok: false, reason: String(err?.message || err) };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "IDING_EXTRACT") {
      try {
        const area = msg.area || "article";
        const result = IdingExtract.extractPage(area);
        lastArea = area;
        lastChunks = result.chunks || [];
        lastTargets = softTargetsForChunks(lastChunks, area);
        clearHighlight();
        sendResponse({
          ok: true,
          chunks: result.chunks,
          kinds: result.kinds || null,
          meta: result.meta,
          count: result.chunks.length,
        });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return true;
    }

    if (msg.type === "IDING_HIGHLIGHT") {
      const result = highlightIndex(Number(msg.index));
      sendResponse(result);
      return true;
    }

    if (msg.type === "IDING_CLEAR_HIGHLIGHT") {
      clearHighlight();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "IDING_PING") {
      sendResponse({ ok: true, href: location.href, targets: lastTargets.length });
      return true;
    }
  });
})();
