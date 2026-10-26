# DSH Workspace Thumbnail Rail

[简体中文](https://github.com/MoruTeaven/dsh-workspace-thumbnail-rail/blob/master/README.zh-CN.md) | English

Give every workspace in DeepSeek Harness (DSH) a thumbnail image, and add a vertical workspace rail between the sidebar and the conversation — like VS Code: **workspaces on the left, conversation on the right**.

## Features

- **Per-workspace thumbnails**: right-click any workspace tile and pick a local image; it is centre-cropped to a square and compressed automatically.
- **Vertical rail**: every workspace is listed in a column between the sidebar and the conversation, matching VS Code's explorer layout.
- **Click to switch**: clicking a thumbnail opens that workspace's conversation.
- **Context menu**: set / remove a thumbnail, remove the workspace, hide the rail.
- **Resizable**: drag the handle at the bottom of the rail to change its width, or hide the rail entirely.
- **Cross-tab sync**: set a thumbnail in one tab and every other open DSH tab updates immediately.
- **Session title filter**: typing in the session header filters the list instantly by title, without a round trip.
- **Content search**: the search button in the session header runs the Host's own message-content index, so you find sessions by what was said inside them, not just by title. Results show a snippet; click one to open it.
- **Rename a session**: right-click a row and choose 重命名 to edit its title in place.
- **Copy session id**: right-click a row and choose 复制会话 ID.
- **Pin a session**: right-click a row and choose 置顶 (shown only when the Host build supports it). Pinned sessions lead the list, matching the order the Host itself uses.
- **Archive view**: the archive button in the session header lists archived sessions with a per-row restore.
- **Rename a workspace**: right-click a tile and choose 重命名 to edit its title in place; a title another workspace already owns is refused.
- **Fork a session**: right-click a row and choose 分支此会话 to branch from its latest completed turn.
- **Reorder sessions**: drag a session row to a new position. Pinned rows do not take part, because their order is the Host's own pin order.
- **Add a workspace**: the + button at the top of the workspace column opens a directory browser — breadcrumb navigation, a "new folder" field, and "选择此目录" to register it.

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