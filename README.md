# @deepseek-ai/dsh-visual-studio

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
- **Annotations**: attach a note to an inspected element (or page coordinate)
  and submit it to the current agent session as an ordinary user message; the
  pending/processed state is kept across preview refreshes.
- **Undo / redo / save / refresh / desktop-mobile viewport** controls.
- **Versioned backups**: before overwriting a file, the previous content is
  written to a sibling `.dsh-visual-studio-backup-<timestamp>` file.

## Architecture

A dual-face Cordis plugin (one package, two halves):

- **Node half** (`src/index.ts`, host tree): registers the `/visual-studio`
  Connection RPC channel (`authority: loopback`) serving `list` / `read` /
  `write` / `create`. Every target path is containment-checked against the
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
- The `dsh.bundle` patch is dormant when installed through a profile patch
  layer rather than `dsh plugin add`.
