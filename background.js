/**
 * Service worker: side panel, extract relay, auto-read on navigation.
 * Neural TTS audio plays in the side panel (SW cannot play Audio).
 */
const DEFAULTS = {
  area: "article",
  mode: "once",
  lang: "zh-CN",
  engine: "edge",
  voice: "zh-CN-XiaoxiaoNeural",
  rate: 1,
  pitch: 0,
  openaiKey: "",
  openaiVoice: "nova",
  autoArmed: false,
  autoTabId: null,
  autoFollowActive: false,
};

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

async function ensureContent(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "IDING_PING" });
    return true;
  } catch (_) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["lib/extract.js", "content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"],
      });
      return true;
    } catch (err) {
      console.warn("inject failed", err);
      return false;
    }
  }
}

async function extractFromTab(tabId, area) {
  const ok = await ensureContent(tabId);
  if (!ok) throw new Error(chrome.i18n.getMessage("injectFail"));
  const res = await chrome.tabs.sendMessage(tabId, { type: "IDING_EXTRACT", area });
  if (!res?.ok) throw new Error(res?.error || chrome.i18n.getMessage("extractFail"));
  return res;
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const cur = await chrome.storage.local.get(null);
  const patch = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (cur[k] === undefined) patch[k] = v;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id != null) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (err) {
      console.warn(err);
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "IDING_GET_ACTIVE_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      sendResponse({ ok: true, tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null });
      return;
    }

    if (msg?.type === "IDING_EXTRACT_ACTIVE") {
      const settings = await getSettings();
      let tabId = msg.tabId;
      if (tabId == null) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id;
      }
      if (tabId == null) throw new Error(chrome.i18n.getMessage("noActiveTab"));
      const area = msg.area || settings.area;
      const data = await extractFromTab(tabId, area);
      sendResponse({ ok: true, ...data, tabId });
      return;
    }

    if (msg?.type === "IDING_HIGHLIGHT") {
      if (msg.tabId != null) {
        try {
          await ensureContent(msg.tabId);
          const res = await chrome.tabs.sendMessage(msg.tabId, {
            type: "IDING_HIGHLIGHT",
            index: msg.index,
          });
          sendResponse({ ok: true, page: res });
          return;
        } catch (err) {
          sendResponse({ ok: false, error: String(err?.message || err) });
          return;
        }
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "IDING_CLEAR_HIGHLIGHT") {
      if (msg.tabId != null) {
        try {
          await chrome.tabs.sendMessage(msg.tabId, { type: "IDING_CLEAR_HIGHLIGHT" });
        } catch (_) {}
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "IDING_SET_AUTO") {
      await chrome.storage.local.set({
        autoArmed: !!msg.armed,
        autoTabId: msg.armed ? (msg.tabId ?? null) : null,
        // follow any http(s) tab when followActive is true
        autoFollowActive: msg.armed ? (msg.followActive !== false) : false,
      });
      sendResponse({ ok: true });
      return;
    }

    // Let side panel / offscreen handle TTS messages; ignore here.
    if (
      msg?.type === "IDING_TTS_EDGE" ||
      msg?.type === "IDING_TTS_OPENAI" ||
      msg?.type === "IDING_TTS_STOP" ||
      msg?.type === "IDING_TTS_PAUSE" ||
      msg?.type === "IDING_TTS_RESUME" ||
      msg?.type === "IDING_AUTO_NAVIGATED" ||
      msg?.type === "IDING_ENSURE_OFFSCREEN"
    ) {
      sendResponse({ ok: true, ignored: true });
      return;
    }

    sendResponse({ ok: false, error: "unknown" });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err?.message || err) });
  });
  return true;
});

async function notifyAutoNav(tabId, url, reason) {
  const settings = await getSettings();
  if (!settings.autoArmed) return;
  if (!/^https?:/i.test(url || "")) return;

  // Prefer follow-active: fire for navigations in the tracked tab OR any active tab
  if (settings.autoFollowActive) {
    // allow any tab; side panel will decide
  } else if (settings.autoTabId != null && tabId !== settings.autoTabId) {
    return;
  }

  const payload = {
    type: "IDING_AUTO_NAVIGATED",
    tabId,
    url: url || "",
    reason: reason || "nav",
    at: Date.now(),
  };
  // Reliable channel for side panel (survives if no live listener yet)
  await chrome.storage.local.set({ autoNavEvent: payload });
  chrome.runtime.sendMessage(payload).catch(() => {});
}

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  await notifyAutoNav(details.tabId, details.url, "completed");
});

// SPA pushState / replaceState
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  await notifyAutoNav(details.tabId, details.url, "history");
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url) {
    await notifyAutoNav(tabId, tab.url, "tabs-complete");
  }
});


chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await notifyAutoNav(activeInfo.tabId, tab.url || "", "activated");
  } catch (_) {}
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const settings = await getSettings();
  if (settings.autoTabId === tabId && !settings.autoFollowActive) {
    await chrome.storage.local.set({ autoArmed: false, autoTabId: null });
  }
});
