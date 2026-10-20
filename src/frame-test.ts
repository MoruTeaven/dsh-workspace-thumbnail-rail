/**
 * Layout verification against a DOM shaped like DSH's real AppFrame.
 *
 * The geometry has to survive things the pure `widenFirst` cases cannot show:
 * a React style rewrite, a resize, and a teardown. This builds the actual
 * element structure (frame > sidebarCol / centerCol / detailsCol / overlayLayer
 * carrying `data-shell-overlay`) and drives `installRail` against it.
 */

import { strict as assert } from "node:assert";

/** The computed grid the fake frame reports, kept in sync with its inline style. */
let computedGrid = "280px 1000px 360px";

/**
 * Minimal DOM stand-ins: installRail only touches style, attributes, class,
 * dataset and children.
 *
 * `gridTemplateColumns` is read and written as a CSS property ACCESSOR, which
 * is how a real CSSStyleDeclaration behaves — the fake maps it onto the same
 * backing store as `setProperty` so tests can seed and read it either way.
 */
class FakeStyle {
  private props = new Map<string, string>();
  getPropertyValue(name: string): string {
    return this.props.get(name) ?? "";
  }
  setProperty(name: string, value: string): void {
    this.props.set(name, value);
  }
  removeProperty(name: string): void {
    this.props.delete(name);
  }
  get gridTemplateColumns(): string {
    return this.getPropertyValue("grid-template-columns");
  }
  set gridTemplateColumns(value: string) {
    this.setProperty("grid-template-columns", value);
  }
  get left(): string {
    return this.getPropertyValue("left");
  }
  set left(value: string) {
    this.setProperty("left", value);
  }
  get width(): string {
    return this.getPropertyValue("width");
  }
  set width(value: string) {
    this.setProperty("width", value);
  }
  get display(): string {
    return this.getPropertyValue("display");
  }
  set display(value: string) {
    this.setProperty("display", value);
  }
  get paddingLeft(): string {
    return this.getPropertyValue("padding-left");
  }
  set paddingLeft(value: string) {
    this.setProperty("padding-left", value);
  }
}

class FakeElement {
  style = new FakeStyle();
  parentElement: FakeElement | null = null;
  readonly dataset: Record<string, string> = {};
  className = "";
  readonly childNodes: FakeElement[] = [];
  private readonly attributes = new Set<string>();

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.childNodes.push(child);
    child.parentElement = this;
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentElement = null;
    return child;
  }

  /** Mimic Element.children: element nodes only. */
  get children(): FakeElement[] {
    return [...this.childNodes];
  }

  setAttribute(name: string): void {
    this.attributes.add(name);
  }

  matches(selector: string): boolean {
    return selector === "[data-shell-overlay]" && this.attributes.has("data-shell-overlay");
  }

  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node !== null) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
}

/** Every observer installRail created, so the test can fire them like React does. */
const observers: (() => void)[] = [];

(globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
  constructor(public callback: () => void) {}
  observe(): void {
    observers.push(this.callback);
  }
  disconnect(): void {}
};

(globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = () => ({
  get gridTemplateColumns(): string {
    return computedGrid;
  },
});

// installRail narrows the frame with `instanceof HTMLElement`, so the fakes must
// really be instances for the test to reach the geometry.
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeElement;

const { installRail } = await import("./frame.js");

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

/**
 * Build a frame shaped like AppFrame.
 *
 * Real child order (AppFrame.tsx:173-198): sidebarCol, centerCol, detailsCol,
 * overlayLayer, then the drag handles — which are frame children carrying a
 * `data-side` attribute.
 */
function makeFrame(): { frame: FakeElement; sidebar: FakeElement; overlay: FakeElement } {
  const frame = new FakeElement("div");
  const sidebar = new FakeElement("div");
  sidebar.className = "sidebarCol-module__abc";
  const center = new FakeElement("div");
  center.className = "centerCol-module__def";
  const details = new FakeElement("div");
  details.className = "detailsCol-module__ghi";
  const overlay = new FakeElement("div");
  overlay.setAttribute("data-shell-overlay");
  const handle = new FakeElement("div");
  handle.className = "handle-module__jkl";
  handle.dataset.side = "sidebar";

  frame.appendChild(sidebar);
  frame.appendChild(center);
  frame.appendChild(details);
  frame.appendChild(overlay);
  frame.appendChild(handle);
  return { frame, sidebar, overlay };
}

/** Fire every observer once, as a real style mutation would. */
function fireObservers(): void {
  for (const callback of observers) callback();
}

/** Seed a frame at the host's default solved widths and return a rail inside it. */
function setup(): {
  frame: FakeElement;
  sidebar: FakeElement;
  overlay: FakeElement;
  rail: FakeElement;
} {
  observers.length = 0;
  computedGrid = "280px 1000px 360px";
  const { frame, sidebar, overlay } = makeFrame();
  frame.style.setProperty("grid-template-columns", computedGrid);
  const rail = new FakeElement("div");
  overlay.appendChild(rail);
  return { frame, sidebar, overlay, rail };
}

/** The frame's inline grid value. */
function grid(frame: FakeElement): string {
  return frame.style.getPropertyValue("grid-template-columns");
}

console.log("frame patch");

check("widens the first track so the rail is the leftmost column", () => {
  const { frame, rail } = setup();
  const patch = installRail(rail as never, 72);
  assert.notEqual(patch, null);
  assert.equal(grid(frame), "352px 1000px 360px");
  assert.equal(patch!.width, 72);
  assert.equal(patch!.offset, 0, "the rail hugs the frame's left edge");
});

check("pads the sidebar so its content clears the rail", () => {
  const { sidebar, rail } = setup();
  installRail(rail as never, 72);
  // A widened grid track does not move its content: without this padding the
  // session list would render underneath the rail.
  assert.equal(sidebar.style.getPropertyValue("padding-left"), "72px");
});

check("re-applies after React rewrites the inline style", () => {
  const { frame, sidebar, rail } = setup();
  installRail(rail as never, 72);
  assert.equal(observers.length, 1, "installRail must watch the frame's style");

  // React re-renders the frame (a panel drag, a window resize) and clobbers
  // the inline style with its own freshly solved widths.
  frame.style.setProperty("grid-template-columns", "300px 980px 360px");
  computedGrid = "300px 980px 360px";
  fireObservers();

  assert.equal(
    grid(frame),
    "372px 980px 360px",
    "the rail is re-applied on top of the host's new widths, not subtracted from them",
  );
  assert.equal(sidebar.style.getPropertyValue("padding-left"), "72px");
});

check("does not accumulate across repeated observer runs", () => {
  const { frame, rail } = setup();
  installRail(rail as never, 72);
  // The computed value reflects our own last write; re-running must be a no-op.
  computedGrid = "352px 1000px 360px";
  fireObservers();
  fireObservers();
  assert.equal(grid(frame), "352px 1000px 360px");
});

check("never lets the sidebar padding accumulate", () => {
  const { sidebar, rail } = setup();
  installRail(rail as never, 72);
  computedGrid = "352px 1000px 360px";
  fireObservers();
  fireObservers();
  assert.equal(sidebar.style.getPropertyValue("padding-left"), "72px");
});

check("follows the host when the user drags the sidebar", () => {
  const { frame, rail } = setup();
  installRail(rail as never, 72);
  // The host re-solves with the user's new sidebar width; our rail rides on top.
  frame.style.setProperty("grid-template-columns", "264px 1016px 360px");
  computedGrid = "264px 1016px 360px";
  fireObservers();
  assert.equal(grid(frame), "336px 1016px 360px");
});

check("restore() puts the host's original grid and padding back", () => {
  const { frame, sidebar, rail } = setup();
  const patch = installRail(rail as never, 72);
  patch!.restore();
  assert.equal(grid(frame), "280px 1000px 360px");
  assert.equal(sidebar.style.getPropertyValue("padding-left"), "");
});

check("restore() is idempotent", () => {
  const { frame, rail } = setup();
  const patch = installRail(rail as never, 72);
  patch!.restore();
  patch!.restore();
  assert.equal(grid(frame), "280px 1000px 360px");
});

check("a hidden rail leaves the host layout untouched", () => {
  const { frame, sidebar, rail } = setup();
  const patch = installRail(rail as never, 0);
  assert.notEqual(patch, null);
  assert.equal(patch!.width, 0);
  assert.equal(grid(frame), "280px 1000px 360px");
  assert.equal(sidebar.style.getPropertyValue("padding-left"), "");
});

check("never re-parents the rail out of React's tree", () => {
  const { overlay, rail } = setup();
  installRail(rail as never, 72);
  assert.equal(
    rail.parentElement,
    overlay,
    "moving the node would make the next reconciliation removeChild the wrong parent",
  );
});

check("returns null when the overlay layer is missing", () => {
  observers.length = 0;
  const orphan = new FakeElement("div");
  assert.equal(installRail(orphan as never, 72), null);
});

console.log(`\n${passed} checks passed`);