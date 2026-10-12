(() => {
  "use strict";

  const OPENAI_VOICES = [
    { id: "nova", label: "nova · " + T("vWarm") },
    { id: "coral", label: "coral · " + T("vSoft") },
    { id: "alloy", label: "alloy · " + T("vNeutral") },
    { id: "echo", label: "echo" },
    { id: "fable", label: "fable" },
    { id: "onyx", label: "onyx" },
    { id: "shimmer", label: "shimmer" },
  ];

  const el = {
    area: () => document.querySelector('input[name="area"]:checked')?.value || "article",
    mode: () => document.querySelector('input[name="mode"]:checked')?.value || "once",
    lang: document.getElementById("lang"),
    engine: document.getElementById("engine"),
    voice: document.getElementById("voice"),
    rate: document.getElementById("rate"),
    rateLabel: document.getElementById("rateLabel"),
    engineHint: document.getElementById("engineHint"),
    btnExtract: document.getElementById("btnExtract"),
    btnOptions: document.getElementById("btnOptions"),
    btnPlay: document.getElementById("btnPlay"),
    playLabel: document.getElementById("playLabel"),
    playIcon: document.getElementById("playIcon"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnStop: document.getElementById("btnStop"),
    btnSettings: document.getElementById("btnSettings"),
    btnCloseSettings: document.getElementById("btnCloseSettings"),
    settingsDrawer: document.getElementById("settingsDrawer"),
    progressFill: document.getElementById("progressFill"),
    progressText: document.getElementById("progressText"),
    status: document.getElementById("status"),
    pageMeta: document.getElementById("pageMeta"),
    preview: document.getElementById("preview"),
  };

  let tabId = null;
  let chunks = [];
  let spokenChunks = [];
  let index = 0;
  let playState = "idle"; // idle | playing | paused
  let runId = 0; // invalidate in-flight runLoop on seek/stop
  let abortSpeak = false;
  let loop = false;
  let browserUtterance = null;
  let autoTimer = null;
  let openaiKey = "";

  function setStatus(msg, kind = "") {
    el.status.textContent = msg || "";
    el.status.className = "status" + (kind ? " " + kind : "");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function saveSettings() {
    await chrome.storage.local.set({
      area: el.area(),
      mode: el.mode(),
      lang: el.lang.value,
      engine: el.engine.value,
      voice: el.voice.value,
      rate: Number(el.rate.value),
    });
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get([
      "area", "mode", "lang", "engine", "voice", "rate", "openaiKey", "openaiVoice",
    ]);
    if (data.area) {
      const r = document.querySelector(`input[name="area"][value="${data.area}"]`);
      if (r) r.checked = true;
    }
    if (data.mode) {
      const r = document.querySelector(`input[name="mode"][value="${data.mode}"]`);
      if (r) r.checked = true;
    }
    let voicePref = data.voice || data.openaiVoice;
    if (data.lang) {
      el.lang.value = data.lang;
    } else {
      // No explicit choice yet: follow Chrome UI language (not saved until user changes something)
      el.lang.value = detectTargetLang();
      if (!data.voice || data.voice === "zh-CN-XiaoxiaoNeural") {
        voicePref = (data.engine || "edge") === "edge" ? IdingEdgeTTS.defaultVoiceForLang(el.lang.value) : data.openaiVoice;
      }
    }
    if (data.engine) el.engine.value = data.engine;
    if (data.rate != null) {
      el.rate.value = data.rate;
      el.rateLabel.textContent = (Math.round(Number(data.rate) * 100) / 100) + "×";
    }
    openaiKey = data.openaiKey || "";
    fillVoiceOptions(voicePref);
  }

  function fillVoiceOptions(preferred) {
    const engine = el.engine.value;
    el.voice.innerHTML = "";
    if (engine === "edge") {
      IdingEdgeTTS.VOICES.forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = v.labelKey ? T(v.labelKey) : v.label;
        el.voice.appendChild(opt);
      });
      const def = preferred && IdingEdgeTTS.VOICES.some((v) => v.id === preferred)
        ? preferred
        : IdingEdgeTTS.defaultVoiceForLang(el.lang.value);
      el.voice.value = def;
      el.engineHint.textContent = T("hintEdge");
    } else if (engine === "openai") {
      OPENAI_VOICES.forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = v.label;
        el.voice.appendChild(opt);
      });
      el.voice.value = preferred && OPENAI_VOICES.some((v) => v.id === preferred) ? preferred : "nova";
      el.engineHint.textContent = openaiKey
        ? T("hintOpenaiKey")
        : T("hintOpenaiNoKey");
    } else {
      const voices = speechSynthesis.getVoices() || [];
      const preferredNames = /neural|google|microsoft|premium|natural|enhanced/i;
      const sorted = [...voices].sort((a, b) => {
        const sa = preferredNames.test(a.name) ? 0 : 1;
        const sb = preferredNames.test(b.name) ? 0 : 1;
        return sa - sb || a.name.localeCompare(b.name);
      });
      const auto = document.createElement("option");
      auto.value = "";
      auto.textContent = T("voiceAuto");
      el.voice.appendChild(auto);
      sorted.forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.name;
        opt.textContent = `${v.name} (${v.lang})${preferredNames.test(v.name) ? " ★" : ""}`;
        el.voice.appendChild(opt);
      });
      if (preferred) el.voice.value = preferred;
      el.engineHint.textContent = T("hintBrowser");
    }
  }

  function displayTextAt(i) {
    if (spokenChunks[i] != null && spokenChunks[i] !== "") return spokenChunks[i];
    return chunks[i] || "";
  }

  function renderPreview() {
    if (!chunks.length) {
      el.preview.textContent = T("previewEmpty");
      return;
    }
    el.preview.innerHTML = chunks
      .map((_, i) => {
        const shown = displayTextAt(i);
        const isOriginal = shown === chunks[i];
        const cls = isOriginal ? "chunk" : "chunk translated";
        return `<p class="${cls}" data-i="${i}" title="${isOriginal ? T("chunkOriginal") : T("chunkTranslated")}">${escapeHtml(shown)}</p>`;
      })
      .join("");
    highlightPreview(index);
  }

  function updatePreviewChunk(i) {
    const node = el.preview.querySelector(`.chunk[data-i="${i}"]`);
    if (!node) return;
    const shown = displayTextAt(i);
    const isOriginal = shown === chunks[i];
    node.textContent = shown;
    node.classList.toggle("translated", !isOriginal);
    node.title = isOriginal ? T("chunkOriginal") : T("chunkTranslated");
  }

  function highlightPreview(i) {
    el.preview.querySelectorAll(".chunk").forEach((node) => {
      const idx = Number(node.getAttribute("data-i"));
      node.classList.toggle("active", idx === i && playState !== "idle");
    });
    const active = el.preview.querySelector(`.chunk[data-i="${i}"]`);
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function updateControls() {
    const has = chunks.length > 0;
    const atStart = !has || index <= 0;
    const atEnd = !has || index >= chunks.length - 1;

    if (playState === "playing") {
      el.playLabel.textContent = T("pause");
      el.playIcon.innerHTML = '<path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/>';
      el.btnPlay.title = T("pause");
      el.btnPlay.setAttribute("aria-label", T("pause"));
      el.btnPlay.disabled = false;
    } else if (playState === "paused") {
      el.playLabel.textContent = T("resume");
      el.playIcon.innerHTML = '<path fill="currentColor" d="M8 5v14l11-7L8 5z"/>';
      el.btnPlay.title = T("resume");
      el.btnPlay.setAttribute("aria-label", T("resume"));
      el.btnPlay.disabled = false;
    } else {
      el.playLabel.textContent = T("play");
      el.playIcon.innerHTML = '<path fill="currentColor" d="M8 5v14l11-7L8 5z"/>';
      el.btnPlay.title = T("play");
      el.btnPlay.setAttribute("aria-label", T("play"));
      el.btnPlay.disabled = false;
    }

    el.btnStop.disabled = playState === "idle";
    // Prev/next: allow when there are chunks; disable at edges
    el.btnPrev.disabled = atStart;
    el.btnNext.disabled = atEnd;
  }

  function updateProgress() {
    const total = chunks.length;
    if (playState === "playing" || playState === "paused") {
      el.progressFill.style.width = Math.round(((index + 1) / Math.max(total, 1)) * 100) + "%";
      el.progressText.textContent = T(playState === "paused" ? "pausedPos" : "readingPos", index + 1, total);
    } else {
      el.progressFill.style.width = "0%";
      el.progressText.textContent = T("readyCount", total);
    }
  }

  async function refreshActiveTab() {
    const res = await chrome.runtime.sendMessage({ type: "IDING_GET_ACTIVE_TAB" });
    tabId = res?.tab?.id ?? null;
    if (res?.tab) {
      el.pageMeta.textContent = `${res.tab.title || ""} · ${res.tab.url || ""}`;
    }
    return tabId;
  }

  async function extractNow() {
    await refreshActiveTab();
    if (tabId == null) throw new Error(T("noActiveTab"));
    setStatus(T("extracting"));
    const res = await chrome.runtime.sendMessage({
      type: "IDING_EXTRACT_ACTIVE",
      tabId,
      area: el.area(),
    });
    if (!res?.ok) throw new Error(res?.error || T("extractFail"));
    chunks = res.chunks || [];
    resetTranslatePipeline();
    spokenChunks = chunks.slice();
    index = 0;
    renderPreview();
    updateProgress();
    updateControls();
    el.pageMeta.textContent = `${res.meta?.title || ""} · ${res.meta?.url || ""}`;
    setStatus(chunks.length ? T("extracted", chunks.length) : T("noContentArea"), chunks.length ? "ok" : "error");
    return chunks.length;
  }

  const TL_MAP = {
    "zh-CN": { google: "zh-CN", bing: "zh-Hans", mymemory: "zh-CN" },
    "zh-TW": { google: "zh-TW", bing: "zh-Hant", mymemory: "zh-TW" },
    en: { google: "en", bing: "en", mymemory: "en" },
    ja: { google: "ja", bing: "ja", mymemory: "ja" },
    ko: { google: "ko", bing: "ko", mymemory: "ko" },
    fr: { google: "fr", bing: "fr", mymemory: "fr" },
    de: { google: "de", bing: "de", mymemory: "de" },
    es: { google: "es", bing: "es", mymemory: "es" },
  };

  let lastTranslateProvider = "";
  let edgeTranslateToken = null;
  let edgeTranslateTokenAt = 0;

  function looksAlreadyTarget(text, tl) {
    const t = (text || "").trim();
    if (!t) return true;
    const han = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    if (tl === "zh-CN" || tl === "zh-TW") return han >= 4 && han >= letters;
    if (tl === "ja") {
      const kana = (t.match(/[\u3040-\u30ff]/g) || []).length;
      return (han + kana) >= 4 && (han + kana) >= letters;
    }
    if (tl === "ko") {
      const hangul = (t.match(/[\uac00-\ud7af]/g) || []).length;
      return hangul >= 4 && hangul >= letters;
    }
    // Latin targets: mostly letters, little Han
    return letters >= 8 && han === 0;
  }

  async function translateViaGoogle(text, tl) {
    const code = (TL_MAP[tl] || TL_MAP["zh-CN"]).google;
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(code)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("google " + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("google bad json");
    const out = data[0].map((row) => row?.[0] || "").join("");
    if (!out) throw new Error("google empty");
    lastTranslateProvider = "Google";
    return out;
  }

  async function getEdgeTranslateToken() {
    if (edgeTranslateToken && Date.now() - edgeTranslateTokenAt < 8 * 60 * 1000) {
      return edgeTranslateToken;
    }
    const res = await fetch("https://edge.microsoft.com/translate/auth", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("edge auth " + res.status);
    const token = (await res.text()).trim();
    if (!token || token.length < 20) throw new Error("edge auth empty");
    edgeTranslateToken = token;
    edgeTranslateTokenAt = Date.now();
    return token;
  }

  async function translateViaBingEdge(text, tl) {
    const code = (TL_MAP[tl] || TL_MAP["zh-CN"]).bing;
    const token = await getEdgeTranslateToken();
    const url =
      `https://api-edge.cognitive.microsofttranslator.com/translate?from=&to=${encodeURIComponent(code)}&api-version=3.0&includeSentenceLength=true`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify([{ Text: text }]),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error("bing " + res.status);
    const data = await res.json();
    const out = data?.[0]?.translations?.[0]?.text || "";
    if (!out) throw new Error("bing empty");
    lastTranslateProvider = T("providerMicrosoft");
    return out;
  }

  async function translateViaMyMemory(text, tl) {
    const code = (TL_MAP[tl] || TL_MAP["zh-CN"]).mymemory;
    // MyMemory needs source|target; use autodetect as en if unknown — better pair auto via "Autodetect"
    const url =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 450))}&langpair=Autodetect|${encodeURIComponent(code)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error("mymemory " + res.status);
    const data = await res.json();
    const out = data?.responseData?.translatedText || "";
    if (!out || /INVALID SOURCE LANGUAGE|MYMEMORY WARNING/i.test(out)) {
      throw new Error("mymemory bad: " + out.slice(0, 80));
    }
    lastTranslateProvider = "MyMemory";
    return out;
  }

  async function translateText(text, tl) {
    const src = (text || "").trim();
    if (!src) return "";
    if (looksAlreadyTarget(src, tl)) {
      lastTranslateProvider = T("providerSkip");
      return src;
    }
    const errors = [];
    // Prefer Microsoft Edge translator (works in mainland China), then Google, then MyMemory
    for (const fn of [translateViaBingEdge, translateViaGoogle, translateViaMyMemory]) {
      try {
        return await fn(src, tl);
      } catch (err) {
        errors.push((err && err.message) || String(err));
      }
    }
    throw new Error(errors.join(" | ") || "translate failed");
  }

  // Per-chunk translation cache + in-flight prefetch for streaming pipeline
  let translateCache = []; // string | undefined
  let translateInflight = []; // Promise<string> | undefined
  let translateFailCount = 0;

  function resetTranslatePipeline() {
    translateCache = [];
    translateInflight = [];
    translateFailCount = 0;
    spokenChunks = [];
  }

  async function translateChunkAt(i) {
    if (i < 0 || i >= chunks.length) return "";
    if (translateCache[i] != null) return translateCache[i];
    if (translateInflight[i]) return translateInflight[i];

    const src = chunks[i];
    const lang = el.lang.value;
    const p = (async () => {
      if (abortSpeak) return src;
      try {
        const translated = await translateText(src, lang);
        if (!translated) throw new Error("empty");
        translateCache[i] = translated;
        spokenChunks[i] = translated;
        updatePreviewChunk(i);
        return translated;
      } catch (_) {
        translateFailCount += 1;
        translateCache[i] = src;
        spokenChunks[i] = src;
        updatePreviewChunk(i);
        return src;
      } finally {
        translateInflight[i] = undefined;
      }
    })();
    translateInflight[i] = p;
    return p;
  }

  function prefetchChunk(i) {
    if (i < 0 || i >= chunks.length) return;
    if (translateCache[i] != null || translateInflight[i]) return;
    // fire-and-forget; abortSpeak checked inside
    translateChunkAt(i).catch(() => {});
  }

  function pickBrowserVoice(lang) {
    const voices = speechSynthesis.getVoices() || [];
    const preferred = /neural|google|microsoft|premium|natural|enhanced/i;
    const named = el.voice.value;
    if (named) {
      const hit = voices.find((v) => v.name === named);
      if (hit) return hit;
    }
    const pool = voices.filter((v) => {
      const vl = (v.lang || "").replace("_", "-").toLowerCase();
      const l = lang.toLowerCase();
      return vl === l || vl.startsWith(l.split("-")[0]);
    });
    const ranked = (pool.length ? pool : voices).slice().sort((a, b) => {
      const sa = preferred.test(a.name) ? 0 : 1;
      const sb = preferred.test(b.name) ? 0 : 1;
      return sa - sb;
    });
    return ranked[0] || null;
  }

  function speakBrowser(text, lang) {
    return new Promise((resolve, reject) => {
      if (abortSpeak) {
        resolve("aborted");
        return;
      }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = Number(el.rate.value) || 1;
      const voice = pickBrowserVoice(lang);
      if (voice) u.voice = voice;
      browserUtterance = u;
      u.onend = () => resolve("end");
      u.onerror = (e) => {
        if (abortSpeak || e.error === "canceled" || e.error === "interrupted") resolve("aborted");
        else reject(e.error || e);
      };
      speechSynthesis.speak(u);
    });
  }

  let audioEl = null;
  let objectUrl = null;

  function stopAudioEl() {
    if (audioEl) {
      try {
        audioEl.onended = null;
        audioEl.onerror = null;
        audioEl.pause();
        audioEl.removeAttribute("src");
        audioEl.load();
      } catch (_) {}
      audioEl = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function playBuffer(buf, mime) {
    return new Promise((resolve, reject) => {
      stopAudioEl();
      const blob = new Blob([buf], { type: mime || "audio/mpeg" });
      objectUrl = URL.createObjectURL(blob);
      audioEl = new Audio(objectUrl);
      audioEl.onended = () => {
        stopAudioEl();
        resolve("end");
      };
      audioEl.onerror = () => {
        stopAudioEl();
        reject(new Error(T("audioFail")));
      };
      const p = audioEl.play();
      if (p && p.catch) p.catch((err) => { stopAudioEl(); reject(err); });
    });
  }

  async function speakOpenAI(text) {
    const data = await chrome.storage.local.get(["openaiKey"]);
    openaiKey = data.openaiKey || "";
    if (!openaiKey) throw new Error(T("noOpenaiKey"));
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + openaiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: el.voice.value || "nova",
        input: text,
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("OpenAI TTS " + res.status + ": " + t.slice(0, 120));
    }
    const buf = await res.arrayBuffer();
    if (abortSpeak) return "aborted";
    return playBuffer(buf, "audio/mpeg");
  }

  async function speakEdge(text) {
    let voice = el.voice.value;
    if (!voice || !IdingEdgeTTS.VOICES.some((v) => v.id === voice)) {
      voice = IdingEdgeTTS.defaultVoiceForLang(el.lang.value);
    }
    const buf = await IdingEdgeTTS.synthesize(text, {
      voice,
      rate: Number(el.rate.value) || 1,
      pitch: 0,
    });
    if (abortSpeak) return "aborted";
    return playBuffer(buf, "audio/mpeg");
  }

  async function speakNeural(text) {
    if (el.engine.value === "openai") return speakOpenAI(text);
    return speakEdge(text);
  }

  async function speakOne(text) {
    const engine = el.engine.value;
    if (engine === "browser") {
      return speakBrowser(text, el.lang.value);
    }
    try {
      return await speakNeural(text);
    } catch (err) {
      console.warn("neural fail, fallback browser", err);
      setStatus(T("neuralFallback"));
      return speakBrowser(text, el.lang.value);
    }
  }

  async function highlightPage(i) {
    highlightPreview(i);
    if (tabId == null) return;
    try {
      let res = await chrome.runtime.sendMessage({ type: "IDING_HIGHLIGHT", tabId, index: i });
      if (res && res.ok === false) {
        // content script may have lost targets — re-extract silently then highlight
        try {
          await chrome.runtime.sendMessage({ type: "IDING_EXTRACT_ACTIVE", tabId, area: el.area() });
        } catch (_) {}
        res = await chrome.runtime.sendMessage({ type: "IDING_HIGHLIGHT", tabId, index: i });
      }
    } catch (_) {}
  }

  async function runLoop(myId) {
    const total = chunks.length;
    while (!abortSpeak && myId === runId) {
      if (index >= total) {
        if (loop) {
          // Re-use cached translations on loop; only reset index
          index = 0;
          await highlightPage(0);
        } else break;
      }
      while (playState === "paused" && !abortSpeak && myId === runId) {
        await new Promise((r) => setTimeout(r, 120));
      }
      if (abortSpeak || myId !== runId) break;

      playState = "playing";
      updateControls();
      updateProgress();
      await highlightPage(index);

      // Translate this chunk (or take cache), prefetch next while we speak
      setStatus(T("translatingN", index + 1, total));
      let spoken;
      try {
        spoken = await translateChunkAt(index);
      } catch (err) {
        spoken = chunks[index];
      }
      if (abortSpeak || myId !== runId) break;
      prefetchChunk(index + 1);
      if (index + 2 < total) prefetchChunk(index + 2);

      const via = lastTranslateProvider ? ` · ${lastTranslateProvider}` : "";
      setStatus(T("readingN", index + 1, total) + via);
      try {
        const result = await speakOne(spoken);
        if (result === "aborted" || abortSpeak || myId !== runId) break;
      } catch (err) {
        if (myId !== runId) break;
        setStatus(T("readError", err.message || err), "error");
        break;
      }

      if (abortSpeak || myId !== runId) break;
      if (playState === "paused") {
        while (playState === "paused" && !abortSpeak && myId === runId) {
          await new Promise((r) => setTimeout(r, 120));
        }
        if (abortSpeak || myId !== runId) break;
      }
      index += 1;
      updateControls();
    }
    if (myId !== runId) return; // superseded by seek/stop/restart
    if (!abortSpeak && index >= total && !loop) {
      if (translateFailCount && translateFailCount === total) {
        finishReading(T("translateAllFail"), "error");
      } else if (translateFailCount) {
        finishReading(T("doneWithFallback", translateFailCount), "ok");
      } else {
        finishReading();
      }
    }
  }

  async function hardStopUtterance() {
    abortSpeak = true;
    try { speechSynthesis.cancel(); } catch (_) {}
    stopAudioEl();
    translateInflight = [];
    await new Promise((r) => setTimeout(r, 40));
  }

  /** Start from the beginning (idle → play). Resets translation pipeline. */
  async function startReading() {
    await hardStopUtterance();
    abortSpeak = false;
    const myId = ++runId;
    loop = el.mode() === "loop";
    await saveSettings();

    try {
      if (!chunks.length) await extractNow();
      if (!chunks.length) {
        setStatus(T("noContent"), "error");
        return;
      }
    } catch (err) {
      setStatus(String(err.message || err), "error");
      return;
    }

    await syncAutoArm();

    // Sync voice with language for edge if still default-ish
    if (el.engine.value === "edge") {
      const cur = el.voice.value;
      const matchesLang = IdingEdgeTTS.VOICES.find((v) => v.id === cur);
      // keep user choice
      if (!matchesLang) {
        el.voice.value = IdingEdgeTTS.defaultVoiceForLang(el.lang.value);
      }
    }

    index = 0;
    resetTranslatePipeline();
    spokenChunks = chunks.slice(); // placeholders until each chunk is translated
    renderPreview(); // show original first, update per translated chunk
    playState = "playing";
    updateControls();
    updateProgress();
    await highlightPage(0);
    try {
      // Stream: translate chunk → speak → prefetch next (no full-doc wait)
      prefetchChunk(0);
      await runLoop(myId);
    } catch (err) {
      if (myId !== runId) return;
      setStatus(T("readFail", err.message || err), "error");
      playState = "idle";
      updateControls();
    }
  }

  /** Jump to chunk i and speak from there (keeps translation cache). */
  async function seekAndPlay(i) {
    if (!chunks.length) {
      try {
        await extractNow();
      } catch (err) {
        setStatus(String(err.message || err), "error");
        return;
      }
      if (!chunks.length) {
        setStatus(T("noContent"), "error");
        return;
      }
    }
    i = Math.max(0, Math.min(chunks.length - 1, Number(i) || 0));
    await hardStopUtterance();
    abortSpeak = false;
    const myId = ++runId;
    loop = el.mode() === "loop";
    index = i;
    // Ensure spokenChunks placeholders exist
    if (spokenChunks.length !== chunks.length) {
      spokenChunks = chunks.slice();
      for (let k = 0; k < translateCache.length; k++) {
        if (translateCache[k] != null) spokenChunks[k] = translateCache[k];
      }
      renderPreview();
    }
    playState = "playing";
    updateControls();
    updateProgress();
    await highlightPage(i);
    try {
      prefetchChunk(i);
      await runLoop(myId);
    } catch (err) {
      if (myId !== runId) return;
      setStatus(T("readFail", err.message || err), "error");
      playState = "idle";
      updateControls();
    }
  }

  function onPlayClick() {
    if (playState === "playing") {
      pauseReading();
    } else if (playState === "paused") {
      resumeReading();
    } else {
      startReading();
    }
  }

  async function goPrev() {
    if (!chunks.length || index <= 0) return;
    await seekAndPlay(index - 1);
  }

  async function goNext() {
    if (!chunks.length) return;
    const target = Math.min(chunks.length - 1, index + 1);
    await seekAndPlay(target);
  }

  async function pauseReading() {
    if (playState !== "playing") return;
    playState = "paused";
    try { speechSynthesis.pause(); } catch (_) {}
    try { if (audioEl && !audioEl.paused) audioEl.pause(); } catch (_) {}
    updateControls();
    updateProgress();
    setStatus(T("paused"));
  }

  async function resumeReading() {
    if (playState !== "paused") return;
    playState = "playing";
    try { speechSynthesis.resume(); } catch (_) {}
    try { if (audioEl && audioEl.paused) await audioEl.play(); } catch (_) {}
    updateControls();
    updateProgress();
    setStatus(T("resumed"));
  }

  async function stopReading(silent) {
    abortSpeak = true;
    runId += 1; // invalidate in-flight loop
    playState = "idle";
    // Drop pending prefetch promises so a late resolve won't speak
    translateInflight = [];
    try { speechSynthesis.cancel(); } catch (_) {}
    stopAudioEl();
    if (tabId != null) {
      await chrome.runtime.sendMessage({ type: "IDING_CLEAR_HIGHLIGHT", tabId }).catch(() => {});
    }
    index = 0;
    highlightPreview(-1);
    updateControls();
    updateProgress();
    if (!silent) setStatus(T("stopped"));
  }

  function finishReading(statusMsg, kind) {
    playState = "idle";
    abortSpeak = false;
    index = 0;
    updateControls();
    updateProgress();
    el.preview.querySelectorAll(".chunk").forEach((n) => n.classList.remove("active"));
    setStatus(statusMsg || T("done"), kind || "ok");
    chrome.runtime.sendMessage({ type: "IDING_CLEAR_HIGHLIGHT", tabId }).catch(() => {});
  }

  let lastAutoAt = 0;
  let lastAutoUrl = "";

  async function handleAutoNavigated(msg) {
    if (!msg || msg.type !== "IDING_AUTO_NAVIGATED") return;
    if (el.mode() !== "auto") return;
    const url = msg.url || "";
    const at = msg.at || Date.now();
    // debounce duplicate events (completed + history + tabs-complete)
    if (url && url === lastAutoUrl && at - lastAutoAt < 1500) return;
    lastAutoUrl = url;
    lastAutoAt = at;

    if (autoTimer) clearTimeout(autoTimer);
    setStatus(T("pageSwitched"));
    autoTimer = setTimeout(async () => {
      if (el.mode() !== "auto") return;
      await stopReading(true);
      tabId = msg.tabId;
      try {
        await refreshActiveTab();
        tabId = msg.tabId; // keep the navigated/activated tab
        // wait a bit more for SPA content
        await new Promise((r) => setTimeout(r, 500));
        await extractNow();
        if (chunks.length) {
          await startReading();
        } else {
          setStatus(T("autoNoContent"), "error");
        }
      } catch (err) {
        setStatus(T("autoFail", err.message || err), "error");
      }
    }, 900);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    handleAutoNavigated(msg);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.autoNavEvent) return;
    handleAutoNavigated(changes.autoNavEvent.newValue);
  });

  async function syncAutoArm() {
    const armed = el.mode() === "auto";
    let tid = tabId;
    if (tid == null) {
      try {
        const res = await chrome.runtime.sendMessage({ type: "IDING_GET_ACTIVE_TAB" });
        tid = res?.tab?.id ?? null;
        tabId = tid;
      } catch (_) {}
    }
    await chrome.runtime.sendMessage({
      type: "IDING_SET_AUTO",
      armed,
      tabId: tid,
      followActive: true,
    });
    if (armed) setStatus(T("autoOn"), "ok");
  }

  function setSettingsOpen(open) {
    if (!el.settingsDrawer || !el.btnSettings) return;
    el.settingsDrawer.hidden = !open;
    el.btnSettings.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function toggleSettings() {
    const open = el.settingsDrawer?.hidden !== false;
    setSettingsOpen(open);
  }

  // Events
  el.btnSettings?.addEventListener("click", () => toggleSettings());
  el.btnCloseSettings?.addEventListener("click", () => setSettingsOpen(false));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") setSettingsOpen(false);
  });
  el.rate.addEventListener("input", () => {
    el.rateLabel.textContent = (Math.round(Number(el.rate.value) * 100) / 100) + "×";
    saveSettings();
  });
  document.querySelectorAll('input[name="area"]').forEach((r) => {
    r.addEventListener("change", async () => {
      await saveSettings();
      await stopReading(true);
      try { await extractNow(); } catch (_) {}
    });
  });
  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener("change", async () => {
      await saveSettings();
      loop = el.mode() === "loop";
      await syncAutoArm();
    });
  });
  el.lang.addEventListener("change", async () => {
    if (el.engine.value === "edge") {
      el.voice.value = IdingEdgeTTS.defaultVoiceForLang(el.lang.value);
    }
    await saveSettings();
  });
  el.engine.addEventListener("change", async () => {
    fillVoiceOptions();
    await saveSettings();
  });
  el.voice.addEventListener("change", saveSettings);
  el.btnExtract.addEventListener("click", async () => {
    await stopReading(true);
    try { await extractNow(); } catch (err) {
      setStatus(String(err.message || err), "error");
    }
  });
  el.btnPlay.addEventListener("click", () => onPlayClick());
  el.btnPrev.addEventListener("click", () => goPrev());
  el.btnNext.addEventListener("click", () => goNext());
  el.btnStop.addEventListener("click", () => stopReading(false));
  el.preview.addEventListener("click", (ev) => {
    const node = ev.target.closest(".chunk");
    if (!node || !el.preview.contains(node)) return;
    const i = Number(node.getAttribute("data-i"));
    if (!Number.isFinite(i)) return;
    seekAndPlay(i);
  });
  el.btnOptions.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  });

  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.onvoiceschanged = () => {
      if (el.engine.value === "browser") fillVoiceOptions(el.voice.value);
    };
  }

  (async () => {
    await loadSettings();
    fillVoiceOptions(el.voice.value);
    await refreshActiveTab();
    updateControls();
    updateProgress();
    await syncAutoArm();
    if (el.mode() !== "auto") setStatus(T("readyOpen"));
  })();
})();
