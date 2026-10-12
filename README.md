# 听页 · Tingye

**听页**（Tingye）— 把当前网页变成有感情的朗读。  
提取正文或交互元素，译成你的目标语言，用 **Microsoft 神经语音** 边译边读。极简侧栏，低调好用。

> Listen to any webpage. Extract article or UI text, translate on the fly, and read aloud with neural TTS.

**作者 / Author:** [IDING DESIGN](https://iding.net) · `iding.net`  
**版本 / Version:** 1.5.0 · **许可 / License:** [MIT](./LICENSE)

Chrome 网上应用店（即将上线）: _[Chrome Web Store 链接占位]_  
官网: [iding.net](https://iding.net)

---

## 功能 Features

| 中文 | English |
| --- | --- |
| **阅读区域**：仅读正文 / 仅读元素（按钮、链接等）/ 全部阅读 | **Read area**: article · interactive elements · all visible text |
| **阅读方式**：连续 / 重复 / 自动（换页或切标签后自动开读） | **Modes**: continuous · loop · auto-read on navigate |
| **流式翻译 + 朗读**：译好一段就读一段，不用等全文 | **Stream translate + TTS**: speak as each chunk is ready |
| **Microsoft 神经语音**（默认）；也可浏览器语音或可选 OpenAI TTS | **Edge neural voices** by default; browser TTS or optional OpenAI |
| **界面多语言**：跟随 Chrome 显示语言（简中/繁中/英/日/韩/法/德/西） | **UI i18n** follows browser language |
| **默认目标语言**：未手动选择时跟随系统语言 | **Default target language** follows system when unset |
| 侧栏预览可点选段落；网页同步高亮 | Click a paragraph in the preview; page highlight follows |
| 翻译兜底：微软 → Google → MyMemory → 原文 | Translation fallback chain for reliability (incl. China networks) |

---

## 安装 Install

### 方式 A：加载已解压扩展（开发者模式）

1. 打开 Chrome → `chrome://extensions/`
2. 打开右上角 **开发者模式**
3. **加载已解压的扩展程序** → 选择本仓库根目录（含 `manifest.json`）
4. 点工具栏「听页」图标，打开侧边栏

### 方式 B：从 Release ZIP 安装

1. 从 [Releases](../../releases) 下载 `tingye-1.5.0.zip`（或本目录同名文件）
2. 解压到任意文件夹
3. 按方式 A 加载该文件夹

> Chrome Web Store 一键安装：链接上线后补在此处。  
> _One-click install from Chrome Web Store: link TBD._

---

## 怎么用 How to use

1. 打开任意 `http` / `https` 网页（`chrome://`、网上应用店等受限页无法注入）
2. 点扩展图标打开侧栏
3. 在 **设置** 中选择阅读区域、方式、目标语言、语音引擎
4. 点 **开始**；需要时可先「提取当前页」预览稿

播放控件：**上一段 / 开始·暂停·继续 / 下一段 / 停止**。停止后「开始」会从第一段重头读。

---

## 隐私 Privacy（摘要）

- 扩展**不收集**账号、浏览历史或分析数据；设置保存在本机 `chrome.storage.local`。
- 朗读/翻译时，**当前页提取出的文本**会发往你选用的服务商（微软翻译/TTS、Google Translate、MyMemory；可选 OpenAI TTS）。
- 可选 OpenAI API Key **仅存本机**，不会上传到 iding.net。
- 完整说明见 [privacy-policy.md](./privacy-policy.md)。

---

## 权限说明 Permissions

| 权限 | 用途 |
| --- | --- |
| `sidePanel` | 侧边栏界面 |
| `storage` | 保存设置与可选 OpenAI Key |
| `activeTab` / `scripting` / `tabs` | 读取当前页、高亮段落 |
| `webNavigation` | 自动阅读：监听页面加载 |
| `declarativeNetRequest` | 调用 Microsoft 语音时修正请求头 |
| 主机权限（翻译 / TTS API） | 微软、Google、MyMemory、可选 OpenAI |
| `http(s)://*/*` | 在普通网页注入提取脚本 |

---

## 目录结构

```
tingye / webpage-reader-extension/
  manifest.json
  background.js
  content.js / content.css
  sidepanel.html / .js / .css
  options.html / options.js
  lib/extract.js · edge-tts.js · i18n.js
  rules/edge_tts.json
  _locales/ …
  icons/
```

---

## 注意 Notes

- Microsoft 神经 TTS 依赖公共 Read Aloud 接口，策略变更时可能失败；可改用浏览器语音或 OpenAI。
- 翻译通道请勿用于高度敏感内容。
- 商店上架素材见同目录 `chrome-store-listing.md`、`screenshots/`。

---

© IDING DESIGN · [iding.net](https://iding.net)
