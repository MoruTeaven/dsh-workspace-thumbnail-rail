/**
 * The default workspace avatar: a "monogram" tile.
 *
 * A workspace without a user-picked thumbnail used to show a generic folder
 * glyph — one shape for every workspace, which is exactly what a thumbnail
 * rail is trying to avoid. Instead the tile now spells the workspace title:
 * the first two characters for latin/digit titles, one character when the
 * title starts wide (CJK and friends occupy two cells, so one is enough).
 *
 * The fill color is "random" but STABLE: it is picked from a fixed palette by
 * hashing the workspace id, so a workspace keeps its color across re-renders,
 * reloads and sibling additions (a Math.random() draw would flicker the whole
 * rail on every state change and reshuffle whenever one row is removed).
 * The palette is deliberately low-saturation, so a rail full of tiles reads
 * calm while the white glyph keeps the same strong contrast in both schemes.
 */

/**
 * Fill colors behind a white glyph: hue variety kept, saturation cut to about
 * 40% (a typical 600-level fill sits near 70%), so the tiles look muted
 * instead of loud. Every entry keeps ≥ 4:1 contrast with the white glyph in
 * both themes.
 *
 * Exported so the thumbnail picker offers the exact same palette the default
 * tiles draw from — a user-picked color then never clashes with the rail's
 * look, and the default suggestion is always one of these.
 */
export const PALETTE = [
  "#554fba", // indigo
  "#4c70bd", // blue
  "#367393", // sky
  "#327788", // cyan
  "#2b766f", // teal
  "#2a715b", // emerald
  "#5f8030", // lime
  "#a3733c", // amber
  "#b46942", // orange
  "#b64c4c", // red
  "#b8465f", // rose
  "#b54d7b", // pink
  "#a44aaf", // fuchsia
  "#874cbd", // purple
  "#764cbd", // violet
  "#3e5372", // slate
] as const;

/**
 * FNV-1a, folded into unsigned 32-bit.
 *
 * Chosen over string hashing tricks like `charCodeAt | 0` because FNV spreads
 * short, similar ids (workspace ids differ by a suffix) across the palette
 * instead of landing neighbours on adjacent entries.
 *
 * @param seed - any string; the workspace id in practice.
 * @returns an unsigned 32-bit hash.
 */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Whether one glyph is "wide" (CJK, Hangul, Kana, fullwidth forms, emoji).
 *
 * Code-point ranges instead of a regex, so surrogate pairs work without the
 * `u` flag and the intent of every range stays greppable.
 *
 * @param glyph - a single grapheme as produced by `Array.from`.
 * @returns true when the glyph fills a full em square.
 */
export function isWideGlyph(glyph: string): boolean {
  const code = glyph.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f)      // Hangul Jamo
    || (code >= 0x2e80 && code <= 0xa4cf)   // CJK radicals … Yi syllables
    || (code >= 0xac00 && code <= 0xd7a3)   // Hangul syllables
    || (code >= 0xf900 && code <= 0xfaff)   // CJK compatibility ideographs
    || (code >= 0xfe30 && code <= 0xfe4f)   // CJK compatibility forms
    || (code >= 0xff00 && code <= 0xff60)   // fullwidth forms
    || (code >= 0xffe0 && code <= 0xffe6)   // fullwidth punctuation
    || (code >= 0x1f000 && code <= 0x1fffd) // emoji and enclosed symbols
    || (code >= 0x20000 && code <= 0x3fffd) // CJK extensions B and beyond
  );
}

/**
 * The glyph run a monogram tile spells out.
 *
 * Two characters for a latin/digit title ("dsh" → "DS"), one when either the
 * first or second character is wide ("工作区" → "工", "A中文" → "A"): mixing
 * a half-width and a full-width glyph reads lopsided at tile sizes. The result
 * is upper-cased so lowercase names do not look like body copy.
 *
 * @param title - the workspace title.
 * @returns 1–2 characters, or "?" when the title is blank.
 */
export function monogramChars(title: string): string {
  const glyphs = Array.from(title.trim());
  const first = glyphs[0];
  if (first === undefined) return "?";
  if (isWideGlyph(first)) return first;
  const second = glyphs[1];
  if (second === undefined || isWideGlyph(second)) return first.toUpperCase();
  return (first + second).toUpperCase();
}

/**
 * The stable fill color for one workspace.
 *
 * @param seed - the string to hash (the workspace id in practice).
 * @returns one palette entry.
 */
export function monogramColor(seed: string): string {
  return PALETTE[hashSeed(seed) % PALETTE.length] as string;
}

/** Props the monogram tile needs. */
export interface MonogramProps {
  /** The workspace title, whose first glyphs are drawn. */
  title: string;
  /** The string the color is hashed from; defaults to the title. */
  seed?: string;
}

/** The colored default tile shown when a workspace has no thumbnail. */
export function Monogram({ title, seed }: MonogramProps) {
  const text = monogramChars(title);
  const background = monogramColor(seed ?? title);
  const wide = isWideGlyph(text);
  return (
    <span
      className={`dsh-wsr-cell__mono${wide ? " dsh-wsr-cell__mono--wide" : ""}`}
      style={{ background }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

/** Props of the user-typed text tile. */
export interface TextTileProps {
  /** The glyphs to spell, as typed by the user (1–4 characters). */
  text: string;
  /** The user-picked fill color. */
  color: string;
}

/**
 * A thumbnail the user typed: same tile geometry as {@link Monogram}, but the
 * glyphs and the fill are the user's. Three or more characters drop to a
 * smaller size so the tile never looks crammed.
 */
export function TextTile({ text, color }: TextTileProps) {
  const glyphs = Array.from(text);
  const sizeClass = glyphs.length >= 3
    ? " dsh-wsr-cell__mono--long"
    : glyphs.length === 1 && isWideGlyph(glyphs[0] ?? "")
      ? " dsh-wsr-cell__mono--wide"
      : "";
  return (
    <span className={`dsh-wsr-cell__mono${sizeClass}`} style={{ background: color }} aria-hidden="true">
      {text}
    </span>
  );
}
