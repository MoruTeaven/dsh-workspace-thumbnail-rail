/**
 * Frame patch tests: the rail must hug the workspace region, not the whole
 * frame. Runs under node with a fake DOM, so no jsdom dependency is needed.
 *
 * The fake reproduces only what `installRail` touches: `closest`, the overlay's
 * parent, the region lookup, `getBoundingClientRect`, and the two observers.
 */

import { strict as assert } from "node:assert";
import { installRail } from "./frame";

const OVERLAY_SELECTOR = "[data-shell-overlay]";
const REGION_SELECTOR = '[class*="regionArea"]';

class FakeStyle {
  private readonly props = new Map<string, string>();
  getPropertyValue(name: string): string {
    return this.props.get(name) ?? "";
  }
  setProperty(name: string, value: string): void {
    this.props.set(name, value);
  }
  get gridTemplateColumns() { return this.getPropertyValue("grid-template-columns"); }
  set gridTemplateColumns(value: string) { this.setProperty("grid-template-columns", value); }
  get paddingLeft() { return this.getPropertyValue("padding-left"); }
  set paddingLeft(value: string) { this.setProperty("padding-left", value); }
  get top() { return this.getPropertyValue("top"); }
  set top(value: string) { this.setProperty("top", value); }
  get height() { return this.getPropertyValue("height"); }
  set height(value: string) { this.setProperty("height", value); }
  get left() { return this.getPropertyValue("left"); }
  set left(value: string) { this.setProperty("left", value); }
  get width() { return this.getPropertyValue("width"); }
  set width(value: string) { this.setProperty("width", value); }
  get display() { return this.getPropertyValue("display"); }
  set display(value: string) { this.setProperty("display", value); }
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

class FakeElement {
  style = new FakeStyle();
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly attributes = new Set<string>();
  className = "";
  dataset: Record<string, string> = {};
  rect: Rect = { top: 0, left: 0, width: 0, height: 0 };
  ownerDocument = { defaultView: globalThis as unknown };

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  setAttribute(name: string): void {
    this.attributes.add(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  matches(selector: string): boolean {
    if (selector === OVERLAY_SELECTOR) return this.attributes.has("data-shell-overlay");
    if (selector === REGION_SELECTOR) return this.className.includes("regionArea");
    return false;
  }

  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node !== null) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector);
      if (nested !== null) return nested;
    }
    return null;
  }

  getBoundingClientRect(): Rect {
    return this.rect;
  }
}

const observers: Array<() => void> = [];
(globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
  constructor(callback: () => void) { observers.push(callback); }
  observe(): void {}
  disconnect(): void {}
};
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  constructor(callback: () => void) { observers.push(callback); }
  observe(): void {}
  disconnect(): void {}
};
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeElement;

function makeDom() {
  const frame = new FakeElement();
  frame.rect = { top: 0, left: 0, width: 1640, height: 900 };
  const region = new FakeElement();
  region.className = "SJMXQW_regionArea";
  region.rect = { top: 112, left: 0, width: 280, height: 620 };
  const overlay = new FakeElement();
  overlay.setAttribute("data-shell-overlay");
  frame.appendChild(region);
  frame.appendChild(overlay);
  const rail = new FakeElement();
  overlay.appendChild(rail);
  return { frame, region, overlay, rail };
}

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("frame patch");

check("returns a patch for a real overlay/region pair", () => {
  const { rail } = makeDom();
  const patch = installRail(rail as unknown as HTMLElement, 72);
  assert.notEqual(patch, null);
});

check("rail top/height come from the workspace region", () => {
  const { rail } = makeDom();
  installRail(rail as unknown as HTMLElement, 72);
  assert.equal(rail.style.top, "112px");
  assert.equal(rail.style.height, "620px");
  assert.equal(rail.style.left, "0px");
  assert.equal(rail.style.width, "72px");
});

check("only the region is padded; the frame grid is untouched", () => {
  const { frame, region, rail } = makeDom();
  frame.style.gridTemplateColumns = "280px 1000px 360px";
  installRail(rail as unknown as HTMLElement, 72);
  assert.equal(region.style.paddingLeft, "72px");
  assert.equal(frame.style.gridTemplateColumns, "280px 1000px 360px");
});

check("a zero width hides the rail and clears the padding", () => {
  const { region, rail } = makeDom();
  installRail(rail as unknown as HTMLElement, 0);
  assert.equal(rail.style.display, "none");
  assert.equal(region.style.paddingLeft, "");
});

check("restore() puts the region padding back and hides the rail", () => {
  const { region, rail } = makeDom();
  const patch = installRail(rail as unknown as HTMLElement, 72);
  assert.notEqual(patch, null);
  patch?.restore();
  assert.equal(region.style.paddingLeft, "");
  assert.equal(rail.style.display, "none");
});

check("returns null when the region is missing", () => {
  const frame = new FakeElement();
  const overlay = new FakeElement();
  overlay.setAttribute("data-shell-overlay");
  frame.appendChild(overlay);
  const rail = new FakeElement();
  overlay.appendChild(rail);
  assert.equal(installRail(rail as unknown as HTMLElement, 72), null);
});

console.log(`\n${passed} checks passed`);
