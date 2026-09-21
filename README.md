<img src="./screenshots/banner.webp" alt="易标使用演示视频" width="100%">

# 易标投标工具箱 - AI智能标书写作助手

<p align="center">
  <strong>简体中文</strong> | <a href="./README.en.md">English</a>
</p>

<p align="left">
  <strong>🚀 开箱即用的 AI 标书编写工具</strong>
  <br>
  易标投标工具箱是一款面向招投标场景的智能标书制作工具，提供 AI 生成技术方案、图文生成、商务标、企业知识库管理、标书查重、废标项检查、标讯等功能，更多功能还在开发中。
  <br>
  支持 OpenAI like 模式的所有 AI API，也支持 ollama、lm studio 等本地模型接入。
  <br>
  <br>
  <strong>❓ 解决什么问题</strong>
  <br>
  面向招投标场景的 AI 标书编写工具。以 gpt-5.6-terra 测试，生成 11 万字的标书，消耗 2,187,250 token，成本约 1.03 元（未统计配图），兼顾质量与成本。
</p>

## 🌐 官方网站

**在线体验**: [https://yibiao.pro](https://yibiao.pro)  【获取更多产品信息、在线体验和技术支持。】

<h2 align="center">✨ 核心功能与优势</h2>
<p align="center">
  <strong>AI写标书 · 标书AI · AI标书生成 · 技术标编写 · 投标文件生成</strong><br>
  <sub>不止生成标书初稿，更强调本地工作区、素材复用、图文表达和流程可恢复。</sub>
</p>

<table>
  <tr>
    <td width="33%" valign="top">
      <strong>💻 本地桌面工作区</strong><br>
      配置、缓存和生成结果保存在本机，适合 Windows 标书文件处理。
    </td>
    <td width="33%" valign="top">
      <strong>📄 多方式文档解析</strong><br>
      支持本地解析与 MinerU 解析配置，兼顾常规文档和复杂文件。
    </td>
    <td width="33%" valign="top">
      <strong>📚 知识库复用</strong><br>
      沉淀企业资料、历史案例和方案素材，让标书AI更贴合业务。
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <strong>🧩 图文与图表</strong><br>
      支持 Mermaid 预览、正文配图和图表转 Word，增强方案表达。
    </td>
    <td width="33%" valign="top">
      <strong>🔄 后台任务恢复</strong><br>
      解析、生成等耗时任务持续落盘，切换页面后仍可恢复进度。
    </td>
    <td width="33%" valign="top">
      <strong>🛡️ 风险检查入口</strong><br>
      预留标书查重、废标项检查工作区，聚焦重复表达和响应完整性。
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <strong>⚙️ 自定义AI配置</strong><br>
      支持文本模型、生图模型、文件解析方式配置，并由 Pi Agent 处理智能体任务。
    </td>
    <td width="33%" valign="top">
      <strong>✏️ 可编辑工作流</strong><br>
      目录、正文和扩写结果可持续调整，方便 AI写标书 后人工定稿。
    </td>
    <td width="33%" valign="top">
      <strong>🔌 插件与开放接口</strong><br>
      支持插件市场扩展能力，并提供开放 API 便于集成。
    </td>
  </tr>
</table>

## 已完成功能

<table>
  <tr>
    <td width="33%" valign="top">
    <ul>
      <li>招标文件解析(18个解析项) </li>
      <li>已有方案扩写</li>
      <li>多标段支持</li>
      <li>多阶段投标支持</li>
      <li>导出格式设置(有预设模版)  </li>
      <li>AI生成图片</li>
      <li>mermaid图片渲染</li>
      <li>html绘图</li>
      <li>字数无上限</li>
      <li>全局事实设定</li>
    </ul>
    </td>
    <td width="33%" valign="top">
    <ul>
      <li>全文一致性检查</li>
      <li>本地知识库</li>
      <li>多份标书查重</li>
      <li>废标项检查</li>
      <li>错别字检查</li>
      <li>逻辑谬误分析</li>
      <li>语义化修改生成结果</li>
      <li>插件系统</li>
      <li>开放API</li>
      <li>投标资源下载</li>
    </ul>
    </td>
    <td width="33%" valign="top">
    </td>
  </tr>
</table>

## 📦 下载与使用

### ⬇️ 下载方式

请通过 [官方网站](https://yibiao.pro) 或客户端内置更新获取最新安装包，运行安装程序即可启动。

### 🎬 使用方式

<a href="https://www.bilibili.com/video/BV1sC5i6SE74">
  <img src="./screenshots/home_2.png" alt="易标使用演示视频" width="100%">
</a>

[点击前往 Bilibili 观看使用演示视频](https://www.bilibili.com/video/BV1sC5i6SE74)

## 🧑‍💻 本地开发调试

桌面客户端代码位于 `client/`，建议使用 Node.js 22；调试 Open XML 功能或本地打包还需要安装 .NET 10 SDK。

### 安装与启动

```powershell
cd client
npm ci
npm run dev
```

Pi Agent SDK 及所需命令工具已随项目提供，无需单独安装。

### 构建与打包

```powershell
cd client
npm run build       # TypeScript 检查与 Vite 构建
npm run dist:win    # Windows x64 安装包和 ZIP
npm run dist:mac    # macOS Intel / Apple Silicon DMG 和 ZIP
```

打包产物位于 `client/release/`。

## 🛠️ 技术架构

- **桌面端**：Electron Main / Preload 提供本地能力，Renderer 通过 `window.yibiao` 调用
- **界面层**：Vite + React + TypeScript，使用全局 CSS 和 Radix UI
- **数据与任务**：配置保存在本地文件，业务状态存入 SQLite；耗时任务在 Main 后台运行并支持恢复
- **AI 与 Agent**：AI Service 统一管理模型请求，Pi Agent 使用独立 Runtime / Session 执行智能体任务
- **文档与在线服务**：支持本地或 MinerU 解析、Open XML 和本地图片渲染；Cloudflare Worker 提供公告、资源、插件、模型信息、许可证及统计服务

### 🏗️ 项目结构

```
易标投标工具箱/
├── client/                    # Electron 桌面客户端
│   ├── electron/              # Main、Preload、IPC 与本地服务
│   ├── src/                   # Renderer 应用源码
│   │   ├── app/               # 路由、菜单与全局 Provider
│   │   ├── components/        # 应用壳层组件
│   │   ├── features/          # 各业务功能模块
│   │   ├── shared/            # 通用类型、UI 与工具函数
│   │   └── styles/            # 全局样式与设计变量
│   ├── scripts/               # 构建、资源准备与校验脚本
│   ├── vendor/agent-tools/    # 各平台 Pi Agent 命令工具
│   ├── assets/                # 客户端图标与静态资源
│   └── package.json           # 客户端依赖和打包配置
├── openxmlhelper/             # .NET 10 Word / Open XML 助手
│   └── src/OpenXmlHelper/     # 助手程序源码
├── analytics/                 # Cloudflare 在线服务
│   ├── worker/                # API、聚合任务与存储逻辑
│   └── dashboard/             # 管理后台
├── sql/
│   └── workspace_schema.sql   # 工作区 SQLite 目标结构
├── screenshots/               # README 图片资源
└── README.md                  # 中文项目说明
```

## 🙋‍♂️ 联系我们

<table>
  <tr>
    <td width="50%" valign="top">

- **官方网站**: [https://yibiao.pro](https://yibiao.pro)
- **邮箱联系**: support@yibiao.pro

    </td>
    <td width="33%" valign="top">
      <p>
        <img src="./screenshots/企业微信.png" alt="企业微信二维码" width="180">
      </p>
    </td>
  </tr>
</table>

---

`AI写标书` `标书AI` `AI标书生成` `免费标书工具`
