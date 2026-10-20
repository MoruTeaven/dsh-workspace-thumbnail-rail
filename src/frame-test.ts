/**
 * Layout verification against a DOM shaped like DSH's real AppFrame.
 *
 * The geometry has to survive things the pure `widenCenter` cases cannot show:
 * a React style rewrite, a resize, and a teardown. This builds the actual
 * element structure (frame > sidebarCol / centerCol / detailsCol / overlayLayer
 * carrying `data-shell-overlay`) and drives `installRail` against it.
 */

import { strict as assert } from "node:assert";

/** The computed grid the fake frame reports, kept in sync with its inline style. */
let computedGrid = "280px 1000px 360px";

/**
 * Minimal DOM stand-ins: installRail only touches style, attributes and class.
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
}

class FakeElement {
  style = new FakeStyle();
  parentElement: FakeElement | null = null;
  readonly dataset: Record<string, string> = {};
  private readonly attributes = new Set<string>();

  constructor(readonly tagName: string) {}

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

const { installRail } = await import("./frame.js");

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

/** Build a frame shaped like AppFrame with an overlay layer inside it. */
function makeFrame(): { frame: FakeElement; overlay: FakeElement } {
  const frame = new FakeElement("div");
  const overlay = new FakeElement("div");
  overlay.setAttribute("data-shell-overlay");
  overlay.parentElement = frame;
  return { frame, overlay };
}

/** Fire every observer once, as a real style mutation would. */
function fireObservers(): void {
  for (const callback of observers) callback();
}

/** Seed a frame at the host's default solved widths and return a rail inside it. */
function setup(): { frame: FakeElement; rail: FakeElement } {
  observers.length = 0;
  computedGrid = "280px 1000px 360px";
  const { frame, overlay } = makeFrame();
  frame.style.setProperty("grid-template-columns", computedGrid);
  const rail = new FakeElement("div");
  rail.parentElement = overlay;
  return { frame, rail };
}

/** The frame's inline grid value. */
function grid(frame: FakeElement): string {
  return frame.style.getPropertyValue("grid-template-columns");
}

console.log("frame patch");

check("carves the rail out of the center track", () => {
  const { frame, rail } = setup();
  const patch = installRail(rail as never, 72);
  assert.notEqual(patch, null);
  assert.equal(grid(frame), "280px 1072px 360px");
  assert.equal(patch!.width, 72);
  assert.equal(patch!.offset, 280, "the rail starts right after the sidebar");
});

check("re-applies after React rewrites the inline style", () => {
  const { frame, rail } = setup();
  installRail(rail as never, 72);
  assert.equal(observers.length, 1, "installRail must watch the frame's style");

  // React re-renders the frame (a panel drag, a window resize) and clobbers
  // the inline style with its own freshly solved widths.
  frame.style.setProperty("grid-template-columns", "300px 980px 360px");
  computedGrid = "300px 980px 360px";
  fireObservers();

  assert.equal(
    grid(frame),
    "300px 1052px 360px",
    "the rail is re-applied on top of the host's new widths, not subtracted from them",
  );
});

check("does not accumulate across repeated observer runs", () => {
  const { frame, rail } = setup();
  installRail(rail as never, 72);
  // The computed value reflects our own last write; re-running must be a no-op.
  computedGrid = "280px 1072px 360px";
  fireObservers();
  fireObservers();
  assert.equal(grid(frame), "280px 1072px 360px");
});

check("follows the sidebar when the host re-solves after a drag", () => {
  const { frame, rail } = setup();
  installRail(rail as never, 72);
  frame.style.setProperty("grid-template-columns", "264px 1016px 360px");
  computedGrid = "264px 1016px 360px";
  fireObservers();
  assert.equal(grid(frame), "264px 1088px 360px");
});

check("restore() puts the host's original style back", () => {
  const { frame, rail } = setup();
  const patch = installRail(rail as never, 72);
  patch!.restore();
  assert.equal(grid(frame), "280px 1000px 360px");
});

check("restore() is idempotent", () => {
  const { frame, rail } = setup();
  const patch = installRail(rail as never, 72);
  patch!.restore();
  patch!.restore();
  assert.equal(grid(frame), "280px 1000px 360px");
});

check("a hidden rail leaves the host layout untouched", () => {
  const { frame, rail } = setup();
  const patch = installRail(rail as never, 0);
  assert.notEqual(patch, null);
  assert.equal(patch!.width, 0);
  assert.equal(grid(frame), "280px 1000px 360px");
});

check("returns null when the overlay layer is missing", () => {
  observers.length = 0;
  const orphan = new FakeElement("div");
  assert.equal(installRail(orphan as never, 72), null);
});

console.log(`\n${passed} checks passed`);