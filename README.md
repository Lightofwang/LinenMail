# 素笺 LinenMail

> 回归纸张般宁静的轻量桌面邮件客户端 — 基于 **Tauri v2 + Rust + React + 嵌入式 SQLite** 构建，专为 Windows 打造。

[![Build Windows EXE](https://github.com/Lightofwang/LinenMail/actions/workflows/build-windows.yml/badge.svg)](https://github.com/Lightofwang/LinenMail/actions/workflows/build-windows.yml)

---

## ✨ 核心特性

### 📬 真实 IMAP / SMTP 加密收发
- 原生支持 **QQ 邮箱、网易 163、Gmail、Outlook / Microsoft 365、腾讯企业邮及任意标准 IMAP/SMTP 邮箱**。
- 内置邮箱初始化连接向导，提供 **IMAP (SSL/TLS) 与 SMTP (SSL/STARTTLS) 实时双向握手测试**。
- 采用 `BODY.PEEK[]` 增量拉取邮件，同步过程不会误改服务端未读状态，并支持未读 / 星标 / 删除状态反向同步。
- 支持多邮箱账户管理、默认发件账户切换、定时发送队列与草稿箱自动持久化。

### 🗄️ 本地嵌入式 SQLite 数据库与安全加密
- 内置 **SQLite (`rusqlite` bundled)**，邮件正文、附件索引、联系人、标签、智能文件夹、过滤规则与系统配置全部本地落盘，断网也可离线检索阅读。
- 所有邮箱授权码与 AI 模型 API Key 均在 Rust 后端通过 **AES-256-GCM** 加密后存储，明文凭证永不暴露给前端界面。
- 邮件正文采用安全纯文本提取解析，彻底隔绝恶意 HTML 与追踪像素。

### 📎 原生附件处理与缓存管理
- 调用 Windows 原生文件选择器添加附件，支持真实 MIME 多附件发送。
- 点击附件直接弹出 Windows **「另存为」原生保存对话框**；即使清理了本地附件缓存，再次下载时也会按需从 IMAP 服务器重新拉取。
- 系统设置内实时展示本地附件缓存与 SQLite 数据库占用空间，支持一键清理缓存。

### 🗂️ 高效整理与智能助手
- **智能文件夹与自定义标签**：按发件人、主题、附件等维度自动归类邮件并实时统计未读数。
- **多条件自动化过滤规则**：支持 `AND / OR` 组合条件，新邮件到达时自动执行打标签、归档、标星、标记已读，并支持一键追溯历史邮件；内置发件人/域名黑名单拦截。
- **自定义大模型助手**：支持配置任意 OpenAI 兼容接口（OpenAI、DeepSeek、本地 Ollama 等），提供邮件一键润色、双语翻译与摘要辅助。

### 🖥️ Windows 原生桌面体验
- **系统托盘常驻**：支持点击关闭按钮最小化至右下角托盘，托盘菜单一键打开主界面、立即同步或撰写新邮件。
- **原生桌面通知**：后台定时增量同步，收到新邮件自动弹出 Windows 系统通知，支持夜间免打扰模式（21:00 - 08:00）。
- **双分发模式**：同时提供 **NSIS 简体中文安装版** 与 **绿色免安装便携版**（支持 U 盘随身携带）。

---

## 📦 下载与安装（Windows）

### 方式一：直接下载云端构建产物（推荐）
1. 进入本仓库的 **[Actions](https://github.com/Lightofwang/LinenMail/actions/workflows/build-windows.yml)** 页面，点开最新一次成功的 `Build Windows EXE (LinenMail)` 构建记录。
2. 在页面底部 **Artifacts** 区域下载 `LinenMail-Windows-x64` 压缩包，解压后包含：
   - `LinenMail_1.0.0_x64-setup.exe` — Windows 简体中文安装程序（无需管理员权限）。
   - `LinenMail-x64-portable.exe` — 单文件绿色运行版。
   - `LinenMail-x64-portable.zip` — 随身便携包（内置 `portable.flag`，解压即用，所有数据保存在同目录 `linenmail-data/` 中）。
3. 也可以在 **[Releases](https://github.com/Lightofwang/LinenMail/releases)** 页面下载正式版本安装包。

### 便携模式说明
- **默认安装模式**：SQLite 数据库（`linenmail.db`）、本地加密密钥（`.linenmail.key`）和附件缓存保存在 `%LOCALAPPDATA%\cn.linenmail.desktop\`。
- **便携模式**：只要在 `linenmail.exe` 同级目录放置一个空文件 `portable.flag`（或创建 `linenmail-data` 文件夹），程序会自动切换为便携模式，所有数据均读写于同目录下的 `linenmail-data/` 文件夹。

---

## ⚙️ 常用邮箱授权码配置速查

| 邮箱服务商 | IMAP 服务器 | IMAP 端口 | SMTP 服务器 | SMTP 端口 | 授权说明 |
| --- | --- | --- | --- | --- | --- |
| **QQ 邮箱** | `imap.qq.com` | `993` | `smtp.qq.com` | `465` | 网页端「设置 → 账户」开启 IMAP/SMTP 并生成 16 位授权码 |
| **网易 163** | `imap.163.com` | `993` | `smtp.163.com` | `465` | 网页端开启 IMAP/SMTP 服务并获取客户端授权密码 |
| **Gmail** | `imap.gmail.com` | `993` | `smtp.gmail.com` | `465` | 开启 Google 两步验证后生成 16 位应用专用密码 |
| **Outlook / 365** | `outlook.office365.com` | `993` | `smtp.office365.com` | `587` | 587 端口自动启用 STARTTLS 加密 |
| **企业邮箱 / 自定义** | 按管理员提供填写 | `993` | 按管理员提供填写 | `465` / `587` | 支持任意标准 IMAP/SMTP 域名 |

---

## 🛠️ 技术栈

- **桌面容器与原生层**：Tauri v2 · Rust · `tauri-plugin-dialog` · `tauri-plugin-notification`
- **邮件协议栈**：`imap` · `lettre` · `mail-parser` · `native-tls`（Windows 原生 SChannel，零 OpenSSL 外部依赖）
- **本地存储与加密**：`rusqlite`（SQLite 源码内置编译）· `aes-gcm`（AES-256-GCM）
- **前端界面**：React 19 · TypeScript · Tailwind CSS v4 · Vite · Lucide Icons

---

## 📂 项目结构

```text
LinenMail/
├── .github/workflows/
│   └── build-windows.yml        # GitHub Actions 自动编译 Windows 安装包与便携版
├── src/                         # React + TypeScript 前端界面
│   ├── views/                   # 收件箱、撰写、智能文件夹、联系人、设置、连接向导等视图
│   ├── components/              # 侧边栏、邮件详情、自定义筛选器等通用组件
│   ├── services/mailService.ts  # Tauri invoke 桥接与本地数据服务层
│   ├── types/mail.ts            # 领域类型定义
│   └── utils/aiClient.ts        # 大模型接口调用封装
├── src-tauri/                   # Tauri v2 + Rust 桌面后端
│   ├── src/
│   │   ├── lib.rs               # 托盘常驻、后台定时同步与定时发信调度器
│   │   ├── commands.rs          # Tauri IPC 命令集合（含原生文件对话框与系统通知）
│   │   ├── db.rs                # SQLite Schema 迁移、邮件/附件/规则持久化
│   │   ├── mail_protocol.rs     # IMAP/SMTP TLS 收发、MIME 解析与附件缓存
│   │   ├── crypto.rs            # AES-256-GCM 本地凭证加解密
│   │   └── models.rs            # 前后端通信数据结构
│   ├── icons/                   # Windows ICO 与多分辨率 PNG 图标
│   ├── capabilities/            # Tauri v2 安全权限声明
│   ├── Cargo.toml
│   └── tauri.conf.json
├── WINDOWS_BUILD.md             # 详细 Windows 本地与云端构建说明
└── package.json
```

---

## 💻 本地开发与打包

### 环境要求（Windows 10 / 11）
- [Node.js 22+](https://nodejs.org/)
- [Rust 工具链](https://rustup.rs/)（默认 `x86_64-pc-windows-msvc`）
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（勾选「使用 C++ 的桌面开发」）
- WebView2 Runtime（Windows 11 及新版 Windows 10 已预装）

### 常用命令

```bash
# 1. 安装前端依赖
npm install

# 2. 启动仅前端开发预览（浏览器访问 http://localhost:3000）
npm run dev

# 3. 启动完整 Tauri 桌面客户端调试模式
npm run tauri:dev

# 4. 打包 Windows NSIS 安装包 (.exe) 与独立可执行文件
npm run tauri:build:nsis

# 5. 仅打包单文件绿色便携版 (.exe)
npm run tauri:build:portable
```

### 自动发布 Release
推送符合 `v*` 格式的标签即可触发 GitHub Actions 自动编译并创建 GitHub Release：

```bash
git tag v1.0.0
git push origin v1.0.0
```

更多构建细节请参阅 [WINDOWS_BUILD.md](./WINDOWS_BUILD.md)。

---

## 🔒 隐私与数据声明

- **纯本地架构**：素笺 LinenMail 无任何中心化云端中转服务器，所有 IMAP/SMTP 通信均直接由您的本机发往对应邮件服务商。
- **凭证安全**：邮箱授权码与 AI API Key 仅以密文形式存于本地数据库，对应的随机 256-bit 密钥保存在本机数据目录的 `.linenmail.key` 文件中。
