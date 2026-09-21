<img src="./screenshots/banner.webp" alt="Yibiao usage demo video" width="100%">

# Yibiao Bid Toolbox - AI Bid Proposal Writing Assistant

<p align="center">
  <a href="./README.md">简体中文</a> | <strong>English</strong>
</p>

<p align="left">
  <strong>🚀 Out-of-the-box AI bid proposal writing tool</strong>
  <br>
  Yibiao Bid Toolbox is an intelligent bid document creation tool for tendering and bidding scenarios. It includes AI-generated technical proposals, image-and-text generation, commercial bid support, enterprise knowledge base management, duplicate checking, rejection-risk checks, tender information, and more features under development.
  <br>
  It supports all OpenAI-compatible AI APIs, as well as local models through Ollama, LM Studio, and similar tools.
  <br>
  <br>
  <strong>❓ What problem does it solve?</strong>
  <br>
  An intelligent bid-writing tool for tendering and bidding scenarios. In a test with gpt-5.6-terra, generating a 110,000-word bid proposal consumed 2,187,250 tokens and cost about CNY 1.03, excluding illustrations — balancing quality and cost.
</p>

## 🌐 Official Website

**Online Experience**: [https://yibiao.pro](https://yibiao.pro)  [Get more product information, online demos, and technical support.]

<h2 align="center">✨ Features & Advantages</h2>

<p align="center">
  <strong>AI Proposal Writing · Bid AI · AI Bid Generation · Technical Proposal Drafting · Tender Response Generation</strong><br>
  <sub>More than proposal draft generation: local workspace, reusable knowledge, visual expression, and recoverable workflows.</sub>
</p>

<table>
  <tr>
    <td width="33%" valign="top">
      <strong>💻 Local Desktop Workspace</strong><br>
      Configurations, caches, and generated results are stored locally, suitable for Windows bid-document workflows.
    </td>
    <td width="33%" valign="top">
      <strong>📄 Multiple Parsing Options</strong><br>
      Supports local parsing and MinerU parser configuration for both regular documents and more complex files.
    </td>
    <td width="33%" valign="top">
      <strong>📚 Knowledge Base Reuse</strong><br>
      Store company materials, historical cases, and proposal assets so bid AI output better matches your business context.
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <strong>🧩 Images & Diagrams</strong><br>
      Supports Mermaid preview, generated illustrations, and diagram conversion for Word export.
    </td>
    <td width="33%" valign="top">
      <strong>🔄 Background Task Recovery</strong><br>
      Long-running parsing and generation tasks are persisted, so progress can be restored after switching pages.
    </td>
    <td width="33%" valign="top">
      <strong>🛡️ Risk Check Workspaces</strong><br>
      Duplicate-check and rejection-risk checklist workspaces are reserved for repeated wording and response-completeness checks.
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <strong>⚙️ Custom AI Configuration</strong><br>
      Configure text models, image models, and file parsing providers, with Pi Agent handling all agent tasks.
    </td>
    <td width="33%" valign="top">
      <strong>✏️ Editable Workflow</strong><br>
      Outlines, generated content, and expansion results remain editable for human review and final polishing.
    </td>
    <td width="33%" valign="top">
      <strong>🔌 Plugins & Open API</strong><br>
      Extend capabilities through a plugin marketplace and integrate via an open API.
    </td>
  </tr>
</table>

## Completed Features

<table>
  <tr>
    <td width="33%" valign="top">
    <ul>
      <li>Tender document parsing (18 extracted items)</li>
      <li>Existing proposal expansion</li>
      <li>Multi-lot support</li>
      <li>Multi-stage bidding support</li>
      <li>Export format settings with preset templates</li>
      <li>AI-generated images</li>
      <li>Mermaid rendering</li>
      <li>HTML drawing</li>
      <li>No word-count limit</li>
      <li>Global facts</li>
    </ul>
    </td>
    <td width="33%" valign="top">
    <ul>
      <li>Full-document consistency checks</li>
      <li>Local knowledge base</li>
      <li>Duplicate checking across multiple bid documents</li>
      <li>Rejection-risk checks</li>
      <li>Typo checking</li>
      <li>Logical fallacy analysis</li>
      <li>Semantic editing of generated content</li>
      <li>Plugin system</li>
      <li>Open API</li>
      <li>Bid resource downloads</li>
    </ul>
    </td>
    <td width="33%" valign="top">
    </td>
  </tr>
</table>

## 📦 Download & Usage

### ⬇️ Download

Get the latest installer from the [official website](https://yibiao.pro) or the in-app update channel, then run the installer or executable file.

### 🎬 Usage Demo

<a href="https://www.bilibili.com/video/BV1sC5i6SE74">
  <img src="./screenshots/home_2.png" alt="Yibiao usage demo video" width="100%">
</a>

[Watch the usage demo on Bilibili](https://www.bilibili.com/video/BV1sC5i6SE74)

## 🧑‍💻 Local Development

The desktop client lives under `client/`. Node.js 22 is recommended. The .NET 10 SDK is also required to debug Open XML features or build local packages.

### Install and Run

```powershell
cd client
npm ci
npm run dev
```

The Pi Agent SDK and its required command-line tools are bundled with the project and do not need to be installed separately.

### Build and Package

```powershell
cd client
npm run build       # TypeScript checks and Vite build
npm run dist:win    # Windows x64 installer and ZIP
npm run dist:mac    # macOS Intel / Apple Silicon DMG and ZIP
```

Packaging artifacts are written to `client/release/`.

## 🛠️ Technical Architecture

- **Desktop**: Electron Main / Preload provides local capabilities, which the Renderer accesses through `window.yibiao`.
- **UI**: Vite + React + TypeScript with global CSS and Radix UI.
- **Data and Tasks**: Configuration is stored in local files and business state in SQLite. Long-running tasks execute in the Main process and can be resumed.
- **AI and Agent**: AI Service manages model requests, while Pi Agent runs agent tasks in independent Runtime / Session instances.
- **Documents and Online Services**: Supports local or MinerU parsing, Open XML, and local image rendering. Cloudflare Worker provides notices, resources, plugins, model information, licensing, and analytics services.

### 🏗️ Project Structure

```
Yibiao Bid Toolbox/
├── client/                    # Electron desktop client
│   ├── electron/              # Main, Preload, IPC, and local services
│   ├── src/                   # Renderer application source
│   │   ├── app/               # Routing, menus, and global providers
│   │   ├── components/        # Application shell components
│   │   ├── features/          # Business feature modules
│   │   ├── shared/            # Shared types, UI, and utilities
│   │   └── styles/            # Global styles and design tokens
│   ├── scripts/               # Build, resource preparation, and verification scripts
│   ├── vendor/agent-tools/    # Pi Agent command-line tools for each platform
│   ├── assets/                # Client icons and static assets
│   └── package.json           # Client dependencies and packaging configuration
├── openxmlhelper/             # .NET 10 Word / Open XML helper
│   └── src/OpenXmlHelper/     # Helper source code
├── analytics/                 # Cloudflare online services
│   ├── worker/                # APIs, aggregation jobs, and storage logic
│   └── dashboard/             # Administration dashboard
├── sql/
│   └── workspace_schema.sql   # Target workspace SQLite schema
├── screenshots/               # README image assets
└── README.md                  # Chinese project README
```

## 🙋‍♂️ Contact

<table>
  <tr>
    <td width="50%" valign="top">

- **Official Website**: [https://yibiao.pro](https://yibiao.pro)
- **Email**: support@yibiao.pro

    </td>
    <td width="33%" valign="top">
      <p>
        <img src="./screenshots/企业微信.png" alt="WeCom QR code" width="180">
      </p>
    </td>
  </tr>
</table>

---

`AI Proposal Writing` `Bid AI` `AI Bid Generation` `Bid Proposal Tool`
