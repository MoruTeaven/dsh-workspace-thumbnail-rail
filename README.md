# DSH Workspace Thumbnail Rail

[简体中文](./README.zh-CN.md) | English

Give every workspace in DeepSeek Harness (DSH) a thumbnail image, and add a vertical workspace rail between the sidebar and the conversation — like VS Code: **workspaces on the left, conversation on the right**.

## Features

- **Per-workspace thumbnails**: right-click any workspace tile and pick a local image; it is centre-cropped to a square and compressed automatically.
- **Vertical rail**: every workspace is listed in a column between the sidebar and the conversation, matching VS Code's explorer layout.
- **Click to switch**: clicking a thumbnail opens that workspace's conversation.
- **Context menu**: set / remove a thumbnail, remove the workspace, hide the rail.
- **Resizable**: drag the handle at the bottom of the rail to change its width, or hide the rail entirely.
- **Cross-tab sync**: set a thumbnail in one tab and every other open DSH tab updates immediately.

## Install

```bash
pnpm install
pnpm run build
```

## 本地开发回路（本地 profile 已链接本仓库）

本机 DSH 的桌面 profile 已用 `link:` 把 `@moruteaven/dsh-workspace-thumbnail-rail`
直接软链接到本仓库目录（位于 `~/.dsh/profiles/headless/node_modules/@moruteaven/`），
因此**不用重新 install**、不用拷贝：`pnpm run build` 之后，直接到 DSH Web GUI 里
**Ctrl+R 刷新**界面就会加载最新 `lib/` 产物。

> 如果将来换了机器或重新 `pnpm install` 后失效，确认
> `~/.dsh/profiles/*/package.json` 里该依赖仍是 `link:...`，且
> `node_modules/@moruteaven/dsh-workspace-thumbnail-rail` 是指向本仓库的链接（而非文件拷贝）。

## Use

1. Right-click any workspace tile in the rail.
2. Choose "设置缩略图" and pick an image.
3. The image is centre-cropped to a 128×128 thumbnail and saved; workspaces without one show a folder icon.

## Notes

- Thumbnails are stored in the browser's local storage and never uploaded.
- "移除此工作区" only unregisters the workspace from DSH — the directory, its files and all session logs are untouched.
- This is a pre-release development version (`0.1.0-dev.1`); the feature set may still change.

## License

MIT