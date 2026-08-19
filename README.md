# @deepseek-ai/dsh-visual-studio

## 中文介绍

[英文](#english)

Visual HTML/SVG Studio（可视化 HTML/SVG 工作室）是一个持久化的 DeepSeek Harness 网页插件：在浏览器里打开、新建、实时预览并保存工作区内的 HTML/SVG 文件，支持「元素检查」与「手动批注」，批注会直接送回当前 Agent 会话，由 AI 精确修改源码。

### 功能特性

- **打开 / 新建 / 保存** 工作区内的 `.html` / `.htm` / `.svg` 文件。
- **实时预览**：源码编辑器旁是隔离 iframe 预览（`sandbox="allow-scripts"`、无 `allow-same-origin`，预览脚本运行在独立源，无法访问父页面 DOM / Cookie）。
- **元素检查模式**：在预览中点击任意 HTML/SVG 元素，显示选框、元素路径、稳定 selector、尺寸与主要 computed styles。
- **会话产物中心**：编写区上方有产物栏，自动追踪当前会话 Agent 创建/修改的文件（显示相对路径、版本、更新时间，点击即打开），按 HTML/SVG、图片、文本分派到对应编辑器；图片可点选/框选定位，文本可在编辑器中选中段落。
- **手动批注**：对选中元素、图片坐标或代码选区添加批注，提交时连同文件相对路径、版本、类型、定位（selector / 坐标 / 行列范围）与选中文本一起送回当前 Agent 会话。
- **自动刷新 + 状态保留**：Agent 修改源码后自动刷新预览，批注的「已处理 / 未处理」状态保留。
- **撤销 / 重做 / 保存 / 刷新 / 桌面-手机视口切换**。
- **版本备份与恢复**：覆盖文件前把旧内容写到同目录 `.dsh-visual-studio-backup-<时间戳>`，可一键恢复上一版本。

### 快速开始

```sh
# 构建
corepack pnpm install
corepack pnpm run build   # tsc -b && tsdown

# 测试
corepack pnpm test

# 安装到当前 web profile（重启后仍存在）
dsh plugin --profile web add <本仓库路径>
```

安装后重启 `dsh web`，右下角会出现 Visual Studio 浮动面板。示例见 `examples/demo.html` 与 `examples/demo.svg`。

---

## English

Visual HTML/SVG Studio — a persistent DeepSeek Harness **web plugin** that opens,
creates, previews, and saves workspace HTML/SVG files, with an element inspector
and agent-routed annotations.

## Features

- **Open / new / save** workspace `.html` / `.htm` / `.svg` files.
- **Live preview** in a sandboxed iframe (`sandbox="allow-scripts"`, no
  `allow-same-origin`, so previewed scripts run in an opaque origin with no
  parent-DOM or cookie access), beside a source editor.
- **Element inspector**: click any element in the preview to see a highlight
  box, breadcrumb path, stable CSS selector, size, and selected computed styles.
- **Session artifacts center**: an artifacts bar above the composer tracks the
  files the current session's agent creates or edits (relative path, version,
  update time) and opens each by type — HTML/SVG preview, image point/box
  select, or text selection.
- **Annotations**: attach a note to an inspected element, an image coordinate,
  or a text selection; the submitted message carries the file's relative path,
  version, kind, location (selector / coordinates / line-column range), and the
  selected text.
- **Undo / redo / save / refresh / desktop-mobile viewport** controls.
- **Versioned backups**: before overwriting a file, the previous content is
  written to a sibling `.dsh-visual-studio-backup-<timestamp>` file and can be
  restored with one click.

## Architecture

A dual-face Cordis plugin (one package, two halves):

- **Node half** (`src/index.ts`, host tree): registers the `/visual-studio`
  Connection RPC channel (`authority: loopback`) serving `list` / `read` /
  `write` / `create` / `artifacts.list` / `backups.restore`, and records each
  session's deliverable artifacts (path, version, relative path) from the
  `fs/observed` event. Every target path is containment-checked against the
  workspace root before any read or write.
- **Browser half** (`src/client/`, client tree): registers the `StudioPanel`
  into the `shell.overlay` slot and injects the file/session callbacks over
  the Connection transport.

The package carries both `dsh.client` (browser roster) and `dsh.bundle`
(`cordis.patch.yml` inserts its own row), so it installs either through
`dsh plugin add` or by adding the row to a profile's `cordis.patch.yml`.

Annotations reach the agent through the existing `session.prompt` RPC
(`mode: 'queue'`) — the same path the chat composer uses — so no custom
session-injection machinery is required.

## Requirements

- **Peer packages** `@deepseek-ai/*` at `^0.1.0-rc.5` (the DeepSeek Harness
  runtime). These come from the `deepseek-ai/deepseek-harness` monorepo (npm or
  a checkout); they are not vendored here.
- Node `>=22.19 || >=24`.

## Build

```sh
corepack pnpm install   # or npm install
corepack pnpm run build # tsc -b && tsdown
```

This emits `lib/index.js` (node half), `lib/invariant.js`, and `lib/client.js`
(the browser bundle).

## Test

```sh
corepack pnpm test
```

## Install into a Harness web profile

```sh
dsh plugin --profile web add <path-to-this-repo>
```

or manually: link this package into `$DSH_HOME/profiles/node_modules/@deepseek-ai/`
and add `- insert: [{ id: visual-studio, name: '@deepseek-ai/dsh-visual-studio' }]`
to `$DSH_HOME/profiles/web/cordis.patch.yml`, then restart `dsh web`.

## Uninstall

Remove the row from `$DSH_HOME/profiles/web/cordis.patch.yml` and delete the
`$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-visual-studio` link (or run
`dsh plugin --profile web remove @deepseek-ai/dsh-visual-studio`), then restart
`dsh web`.

## Examples

`examples/demo.html` and `examples/demo.svg` are the files used to exercise the
"click element → annotate → agent edits → auto-refresh" loop.

## Known Limitations and Deferred Work

- The preview iframe still runs user-authored scripts (`allow-scripts`); they
  are confined to an opaque origin but are not sanitized.
- Undo history and annotation state are session-local (annotations persist via
  `localStorage`; undo history does not survive a page reload).
- The session artifacts registry is in-memory: it resets when `dsh web`
  restarts and repopulates as the agent writes files again.
- The `dsh.bundle` patch is dormant when installed through a profile patch
  layer rather than `dsh plugin add`.
