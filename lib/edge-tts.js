/**
 * Microsoft Edge Read Aloud neural TTS (WebSocket).
 * Protocol aligned with rany2/edge-tts (TrustedClientToken + Sec-MS-GEC).
 * In Chrome, Origin is rewritten via declarativeNetRequest to the Edge Read Aloud id.
 */
(function (global) {
  "use strict";

  const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  const CHROMIUM_FULL_VERSION = "143.0.3650.75";
  const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
  const WSS_BASE =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
  const WIN_EPOCH = 11644473600;

  function _t(k) {
    try { return chrome.i18n.getMessage(k) || k; } catch (_) { return k; }
  }

  const VOICES = [
    { id: "zh-CN-XiaoxiaoNeural", labelKey: "vXiaoxiao", lang: "zh-CN" },
    { id: "zh-CN-YunxiNeural", labelKey: "vYunxi", lang: "zh-CN" },
    { id: "zh-CN-YunyangNeural", labelKey: "vYunyang", lang: "zh-CN" },
    { id: "zh-CN-XiaoyiNeural", labelKey: "vXiaoyi", lang: "zh-CN" },
    { id: "zh-TW-HsiaoChenNeural", labelKey: "vHsiaoChen", lang: "zh-TW" },
    { id: "en-US-JennyNeural", label: "Jenny · English", lang: "en-US" },
    { id: "en-US-GuyNeural", label: "Guy · English", lang: "en-US" },
    { id: "ja-JP-NanamiNeural", label: "Nanami · 日本語", lang: "ja-JP" },
    { id: "ko-KR-SunHiNeural", label: "SunHi · 한국어", lang: "ko-KR" },
    { id: "fr-FR-DeniseNeural", label: "Denise · Français", lang: "fr-FR" },
    { id: "de-DE-KatjaNeural", label: "Katja · Deutsch", lang: "de-DE" },
    { id: "es-ES-ElviraNeural", label: "Elvira · Español", lang: "es-ES" },
  ];

  const LANG_DEFAULT_VOICE = {
    "zh-CN": "zh-CN-XiaoxiaoNeural",
    zh: "zh-CN-XiaoxiaoNeural",
    "zh-TW": "zh-TW-HsiaoChenNeural",
    en: "en-US-JennyNeural",
    "en-US": "en-US-JennyNeural",
    ja: "ja-JP-NanamiNeural",
    ko: "ko-KR-SunHiNeural",
    fr: "fr-FR-DeniseNeural",
    de: "de-DE-KatjaNeural",
    es: "es-ES-ElviraNeural",
  };

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function muid() {
    return [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }

  async function generateSecMsGec() {
    let ticks = Date.now() / 1000 + WIN_EPOCH;
    ticks -= ticks % 300;
    const windowsTicks = Math.floor(ticks * 1e9 / 100);
    const data = new TextEncoder().encode(`${windowsTicks}${TRUSTED_CLIENT_TOKEN}`);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  function escapeXml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /** rate: 0.5–2.0 UI multiplier → SSML % */
  function rateToSsml(rate) {
    const n = Number(rate) || 1;
    const pct = Math.round((n - 1) * 100);
    return (pct >= 0 ? `+${pct}` : `${pct}`) + "%";
  }

  function pitchToSsml(pitch) {
    const n = Number(pitch) || 0;
    return (n >= 0 ? `+${n}` : `${n}`) + "Hz";
  }

  function buildSsml(text, voice, rate, pitch) {
    const lang = (voice.match(/^[a-z]{2}-[A-Z]{2}/) || ["zh-CN"])[0];
    return (
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">` +
      `<voice name="${voice}">` +
      `<prosody rate="${rateToSsml(rate)}" pitch="${pitchToSsml(pitch)}">` +
      escapeXml(text) +
      `</prosody></voice></speak>`
    );
  }

  function indexOfSub(arr, sub) {
    outer: for (let i = 0; i <= arr.length - sub.length; i++) {
      for (let j = 0; j < sub.length; j++) {
        if (arr[i + j] !== sub[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  /**
   * Synthesize text → MP3 ArrayBuffer via Edge Read Aloud WebSocket.
   */
  async function synthesize(text, options = {}) {
    const voice = options.voice || "zh-CN-XiaoxiaoNeural";
    const rate = options.rate ?? 1;
    const pitch = options.pitch ?? 0;
    if (!text || !String(text).trim()) throw new Error(_t("emptyText"));

    const connectId = uuid();
    const secMsGec = await generateSecMsGec();
    const url =
      `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
      `&ConnectionId=${connectId}`;

    const ssml = buildSsml(text, voice, rate, pitch);
    const audioChunks = [];

    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      const timer = setTimeout(() => {
        try { ws?.close(); } catch (_) {}
        if (!settled) {
          settled = true;
          if (audioChunks.length) resolve(concatChunks(audioChunks));
          else reject(new Error(_t("ttsTimeout")));
        }
      }, 30000);

      try {
        // Cookie helps some edge deployments; browsers may ignore settable Cookie on WS
        ws = new WebSocket(url);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }

      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        const ts = new Date().toUTCString();
        const config =
          `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},` +
          `"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
        ws.send(config);
        const speech =
          `X-RequestId:${connectId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}\r\nPath:ssml\r\n\r\n${ssml}`;
        ws.send(speech);
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          if (ev.data.includes("Path:turn.end")) {
            clearTimeout(timer);
            try { ws.close(); } catch (_) {}
            if (!settled) {
              settled = true;
              if (!audioChunks.length) reject(new Error(_t("ttsNoAudio")));
              else resolve(concatChunks(audioChunks));
            }
          }
          return;
        }
        const buf = new Uint8Array(ev.data);
        const needle = new TextEncoder().encode("Path:audio\r\n");
        let idx = indexOfSub(buf, needle);
        if (idx !== -1) {
          let audio = buf.slice(idx + needle.length);
          if (audio.length >= 2 && audio[0] === 13 && audio[1] === 10) audio = audio.slice(2);
          if (audio.length) audioChunks.push(audio);
          return;
        }
        // fallback: header \r\n\r\n
        const sepNeedle = new TextEncoder().encode("\r\n\r\n");
        const sep = indexOfSub(buf, sepNeedle);
        if (sep !== -1) {
          const header = new TextDecoder().decode(buf.slice(0, sep));
          if (header.includes("Path:audio")) {
            const audio = buf.slice(sep + 4);
            if (audio.length) audioChunks.push(audio);
          }
        }
      };

      ws.onerror = () => {
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        if (!settled) {
          settled = true;
          if (audioChunks.length) resolve(concatChunks(audioChunks));
          else reject(new Error(_t("ttsWsFail")));
        }
      };

      ws.onclose = () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          if (audioChunks.length) resolve(concatChunks(audioChunks));
          else reject(new Error(_t("ttsClosed")));
        }
      };
    });
  }

  function concatChunks(chunks) {
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out.buffer;
  }

  function defaultVoiceForLang(lang) {
    if (!lang) return "zh-CN-XiaoxiaoNeural";
    if (LANG_DEFAULT_VOICE[lang]) return LANG_DEFAULT_VOICE[lang];
    const prefix = String(lang).split("-")[0];
    return LANG_DEFAULT_VOICE[prefix] || "zh-CN-XiaoxiaoNeural";
  }

  global.IdingEdgeTTS = {
    VOICES,
    synthesize,
    defaultVoiceForLang,
    buildSsml,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
