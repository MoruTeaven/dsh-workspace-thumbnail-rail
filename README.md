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