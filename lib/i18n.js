/* Tingye i18n helper: T(key, ...subs) + data-i18n / data-i18n-title / data-i18n-aria / data-i18n-placeholder */
(function (g) {
  "use strict";
  function T(key, ...subs) {
    try {
      const s = chrome.i18n.getMessage(key, subs.map(String));
      if (s) return s;
    } catch (_) {}
    return key;
  }
  function applyI18n(root) {
    const r = root || document;
    r.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = T(n.dataset.i18n); });
    r.querySelectorAll("[data-i18n-title]").forEach((n) => { n.title = T(n.dataset.i18nTitle); });
    r.querySelectorAll("[data-i18n-aria]").forEach((n) => { n.setAttribute("aria-label", T(n.dataset.i18nAria)); });
    if (document.documentElement && chrome.i18n?.getUILanguage) {
      document.documentElement.lang = chrome.i18n.getUILanguage();
    }
  }
  // Map Chrome UI language -> supported translation target code
  function detectTargetLang() {
    const ui = String((chrome.i18n?.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || "en").toLowerCase();
    if (ui.startsWith("zh")) {
      return /^(zh-(tw|hk|mo)|zh-hant)/.test(ui) ? "zh-TW" : "zh-CN";
    }
    const p = ui.split(/[-_]/)[0];
    return ["en", "ja", "ko", "fr", "de", "es"].includes(p) ? p : "en";
  }
  g.T = T;
  g.applyI18n = applyI18n;
  g.detectTargetLang = detectTargetLang;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => applyI18n());
    else applyI18n();
  }
})(typeof globalThis !== "undefined" ? globalThis : self);
