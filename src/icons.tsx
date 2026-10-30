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

/** Menu item: open the workspace's most recent conversation. */
export const ClockIcon = (props: IconProps = {}) =>
  base(props.size ?? 14, props, <>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
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

/**
 * Fold/unfold caret for a parent tile in the rail tree.
 *
 * The same chevron rotates instead of swapping glyphs, so folding never makes
 * the row jump: the SVG stays the same box in both states.
 */
export const ChevronIcon = ({ open = false, ...props }: IconProps & { open?: boolean } = {}) =>
  base(props.size ?? 9, { ...props, style: { transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" } }, <>
    <path d="m9 18 6-6-6-6" />
  </>);
