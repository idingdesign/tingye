# 听页 · Chrome 扩展

**听页**（Tingye）— 把当前网页变成有感情的朗读。从**当前标签页**提取正文 / 页面元素，译成目标语言后边译边读，默认使用 **Microsoft 神经语音**。

## 安装（开发者模式加载）

1. 打开 Chrome，地址栏进入 `chrome://extensions/`
2. 右上角打开 **开发者模式**
3. 点 **加载已解压的扩展程序**
4. 选择本文件夹（桌面「听页阅读器-扩展」或源码 `webpage-reader-extension`）
5. 工具栏出现「听页」图标；点图标打开**侧边栏**

回退：在同一页关闭扩展或点「移除」即可；不会改你的网页文件。若曾用桌面版 HTML 阅读器，可继续单独使用，互不影响。

## 怎么用

1. 打开任意 `http/https` 网页
2. 点扩展图标打开侧栏「听页」
3. 在「设置」里选择阅读区域、方式、目标语言、语音引擎
4. 点 **开始**（需要时可在设置里「提取当前页」预览）

### 阅读区域

| 选项 | 含义 |
| --- | --- |
| 仅读正文 | 尽量识别 article/main 正文 |
| 仅读元素 | 按钮、链接文案、输入框标签等 |
| 全部阅读 | 可见文本节点拼接 |

### 阅读方式

| 选项 | 含义 |
| --- | --- |
| 连续阅读 | 读完一遍结束 |
| 重复阅读 | 循环朗读 |
| 自动阅读 | 选中后即生效；切换标签或同标签跳转后自动提取并开读（侧栏需保持打开） |

### 语音引擎

1. **Microsoft 神经语音（推荐）** — Edge Read Aloud 同款 Neural（晓晓 / 云希 / 云扬 / 晓伊等）。免费，无需 Key。若被网络拦截，会自动回退浏览器语音。
2. **浏览器语音** — `speechSynthesis`，优先名称含 Neural / Google / Microsoft / Premium 的音色。
3. **OpenAI TTS（可选）** — 在扩展「选项」里粘贴 API Key，使用 `gpt-4o-mini-tts`（nova / coral 等）。Key 只存在本机 `chrome.storage.local`。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `sidePanel` | 侧边栏界面 |
| `storage` | 保存设置与可选 OpenAI Key |
| `activeTab` / `scripting` / `tabs` | 读取当前页 DOM、高亮当前段落 |
| `webNavigation` | 自动阅读：监听标签页加载完成 |
| `declarativeNetRequest` | 调用 Microsoft 语音时修正 Origin / UA（与开源 edge-tts 一致） |
| 主机权限 `translate.googleapis.com` 等 | 翻译通道（微软 / Google / MyMemory） |
| 主机权限 `speech.platform.bing.com` | Microsoft 神经 TTS |
| 主机权限 `api.openai.com` | 可选 OpenAI TTS |
| 主机权限 `http(s)://*/*` | 在普通网页注入提取脚本 |

## 目录结构

```
webpage-reader-extension/
  manifest.json
  background.js
  content.js / content.css
  sidepanel.html / .js / .css
  options.html / options.js
  lib/extract.js
  lib/edge-tts.js
  rules/edge_tts.json
  icons/
  README.md
```

## 注意

- 无法在 `chrome://`、Chrome 网上应用店、PDF 查看器等受限页注入脚本。
- Microsoft 神经 TTS 依赖公共 Read Aloud 接口，若微软收紧策略可能失败；届时请改用浏览器语音或 OpenAI。
- 翻译有多级兜底（微软 → Google → MyMemory → 原文），请勿用于敏感内容。
