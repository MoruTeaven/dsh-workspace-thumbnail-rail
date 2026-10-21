/** Minimal inline SVG icons — paths from Lucide (ISC license, https://lucide.dev). */
import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  [key: string]: unknown;
}

function base(size: number, props: IconProps, children: ReactNode) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Placeholder glyph shown for a workspace that has no thumbnail yet. */
export const FolderIcon = (props: IconProps = {}) =>
  base(props.size ?? 18, props, <>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </>);

/** Session list header: start a new session in this workspace. */
export const PlusIcon = (props: IconProps = {}) =>
  base(props.size ?? 14, props, <>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </>);

/** Menu item: choose a thumbnail image for this workspace. */
export const ImageIcon = (props: IconProps = {}) =>
  base(props.size ?? 14, props, <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
  </>);

/** Menu item: drop this workspace's thumbnail. */
export const ImageOffIcon = (props: IconProps = {}) =>
  base(props.size ?? 14, props, <>
    <path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062a.5.5 0 0 1 .752.432V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.5l2.352-2.971A2.2 2.2 0 0 1 10.336 2H14" />
    <path d="m2 2 20 20" />
  </>);

/** Menu item: reset the workspace title back to its directory name. */
export const RotateCcwIcon = (props: IconProps = {}) =>
  base(props.size ?? 14, props, <>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </>);

/** Menu item: unregister the workspace from DSH (the directory is untouched). */
export const TrashIcon = (props: IconProps = {}) =>
  base(props.size ?? 14, props, <>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>);

/** Menu item: move the rail itself. */
export const ColumnsIcon = (props: IconProps = {}) =>
  base(props.size ?? 14, props, <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
  </>);

/** Menu item: open a session. */
export const OpenIcon = (props: IconProps = {}) =>
  base(props.size ?? 14, props, <>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </>);

/** Menu item: archive a session. */
export const ArchiveIcon = (props: IconProps = {}) =>
  base(props.size ?? 14, props, <>
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </>);