(async () => {
  const keyEl = document.getElementById("openaiKey");
  const voiceEl = document.getElementById("openaiVoice");
  const status = document.getElementById("status");
  const data = await chrome.storage.local.get(["openaiKey", "openaiVoice"]);
  if (data.openaiKey) keyEl.value = data.openaiKey;
  if (data.openaiVoice) voiceEl.value = data.openaiVoice;

  document.getElementById("save").addEventListener("click", async () => {
    await chrome.storage.local.set({
      openaiKey: keyEl.value.trim(),
      openaiVoice: voiceEl.value,
    });
    status.textContent = T("saved");
  });
  document.getElementById("clear").addEventListener("click", async () => {
    keyEl.value = "";
    await chrome.storage.local.set({ openaiKey: "" });
    status.textContent = T("cleared");
  });
})();
