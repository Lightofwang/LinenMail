# 素笺 LinenMail — Windows `.exe` 打包与使用指南

本项目已完整配置 **Tauri v2 + Rust + 嵌入式 SQLite** 桌面端工程，可在 Windows 10 / 11 上直接编译打包为：
1. **NSIS 简体中文安装程序**（`LinenMail_1.0.0_x64-setup.exe`）
2. **绿色免安装单文件便携版**（`linenmail.exe`）

---

## 1. Windows 本地构建环境准备

在 Windows 电脑上执行打包前，请确认已安装以下基础工具（均免费）：
1. **Node.js 20+**（https://nodejs.org）
2. **Rust 工具链**（https://rustup.rs，选择默认 `x86_64-pc-windows-msvc`）
3. **Microsoft C++ Build Tools**（Visual Studio Build Tools 中勾选「使用 C++ 的桌面开发」）
4. **WebView2 Runtime**（Windows 11 与新版 Windows 10 已内置）

> 说明：本工程的网络与 TLS 层已全部配置为 Windows 原生 `native-tls`（SChannel），SQLite 使用 `rusqlite` 内嵌源码编译（`bundled`），**无需**额外安装 OpenSSL、Perl 或 SQLite DLL。

---

## 2. 安装依赖与本地调试

```powershell
npm install
npm run tauri:dev
```

---

## 3. 打包 Windows `.exe`

### 方式一：构建 NSIS 安装包（推荐）
```powershell
npm run tauri:build:nsis
```
产物路径：
- `src-tauri/target/release/bundle/nsis/LinenMail_1.0.0_x64-setup.exe`
- 同时也会生成独立可执行文件：`src-tauri/target/release/linenmail.exe`

### 方式二：仅构建绿色免安装便携版 `.exe`
```powershell
npm run tauri:build:portable
```
产物路径：
- `src-tauri/target/release/linenmail.exe`

**便携模式数据目录说明**：
- 默认情况下，SQLite 数据库（`linenmail.db`）、本地加密密钥（`.linenmail.key`）和附件缓存保存在 Windows 用户目录 `%LOCALAPPDATA%\cn.linenmail.desktop\`。
- 若需制作 **U 盘随身便携版**，只需在 `linenmail.exe` 同级目录新建一个空文件 `portable.flag`（或空文件夹 `linenmail-data`），程序启动后即自动将数据库与附件全部保存在同目录的 `linenmail-data/` 中。

---

## 4. 常用邮箱 IMAP/SMTP 授权码说明

| 服务商 | IMAP 服务器 | IMAP 端口 | SMTP 服务器 | SMTP 端口 | 说明 |
| --- | --- | --- | --- | --- | --- |
| QQ 邮箱 | `imap.qq.com` | `993` | `smtp.qq.com` | `465` | 需在网页端「设置 → 账户」开启 IMAP/SMTP 并生成 16 位授权码 |
| 网易 163 | `imap.163.com` | `993` | `smtp.163.com` | `465` | 需在网页端开启 IMAP/SMTP 服务并使用客户端授权密码 |
| Gmail | `imap.gmail.com` | `993` | `smtp.gmail.com` | `465` | 需开启两步验证后生成 16 位应用专用密码 |
| Outlook / 365 | `outlook.office365.com` | `993` | `smtp.office365.com` | `587` | 自动使用 STARTTLS 安全连接 |
| 腾讯企业邮 / 自定义 | 按服务商提供 | `993` | 按服务商提供 | `465` / `587` | 支持自定义任意标准 IMAP/SMTP 域名 |
