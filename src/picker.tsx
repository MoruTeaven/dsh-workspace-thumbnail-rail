/**
 * The thumbnail setup panel.
 *
 * "Set thumbnail" used to throw the OS file dialog at the user immediately;
 * now it opens this small panel first, offering the two modes:
 *
 * - 图片 — hands off to the existing file-picker flow (crop + compress stays);
 * - 文字 — the user spells 1–4 characters on a color they pick, saved as a
 *   {@link TextThumbnailRecord}.
 *
 * The panel is a fixed, centered card over a click-away scrim. State is local:
 * nothing is persisted until 保存 (text mode) or the file dialog completes
 * (image mode, handled by the rail's existing flow).
 */

import { useEffect, useState } from "react";
import { CheckIcon, ImageIcon, TrashIcon, TypeIcon, XIcon } from "./icons";
import { PALETTE, TextTile } from "./monogram";
import type { ThumbnailRecord } from "./types";

/** Props the panel needs from the rail. */
export interface ThumbnailPickerProps {
  /** The workspace's title, shown in the panel header. */
  title: string;
  /** The workspace's current thumbnail, if any (seeds the text fields). */
  current: ThumbnailRecord | undefined;
  /** Close without saving. */
  onClose(): void;
  /** Switch to the image file dialog (the panel closes first). */
  onPickImage(): void;
  /** Persist a text tile. */
  onSaveText(text: string, color: string): void;
  /** Drop the current thumbnail. */
  onRemove(): void;
}

/** The thumbnail setup panel for one workspace. */
export function ThumbnailPicker(props: ThumbnailPickerProps) {
  const previous = props.current?.kind === "text" ? props.current : undefined;
  const [mode, setMode] = useState<"image" | "text">(previous === undefined ? "image" : "text");
  const [text, setText] = useState(previous?.text ?? "");
  const [color, setColor] = useState(previous?.color ?? (PALETTE[0] as string));

  /** Escape closes the panel, mirroring the context menu. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const trimmed = text.trim();
  const canSave = trimmed !== "";
  const previewText = trimmed === "" ? "?" : trimmed;
  const previewGhost = trimmed === "";

  return (
    <>
      <div className="dsh-wsr-scrim" onPointerDown={props.onClose} />
      <div className="dsh-wsr-picker" role="dialog" aria-label={`设置 ${props.title} 的缩略图`}>
        <div className="dsh-wsr-picker__head">
          <span className="dsh-wsr-picker__title">设置缩略图 · {props.title}</span>
          <button
            type="button"
            className="dsh-wsr-picker__close"
            aria-label="关闭"
            onClick={props.onClose}
          >
            <XIcon size={14} />
          </button>
        </div>

        <div className="dsh-wsr-picker__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "image"}
            className={`dsh-wsr-picker__tab${mode === "image" ? " dsh-wsr-picker__tab--on" : ""}`}
            onClick={() => setMode("image")}
          >
            <ImageIcon size={14} /> 图片
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "text"}
            className={`dsh-wsr-picker__tab${mode === "text" ? " dsh-wsr-picker__tab--on" : ""}`}
            onClick={() => setMode("text")}
          >
            <TypeIcon size={14} /> 文字
          </button>
        </div>

        {mode === "image" ? (
          <div className="dsh-wsr-picker__body">
            <p className="dsh-wsr-picker__hint">
              选择一张图片，会自动居中裁剪并压缩后保存到本地。
            </p>
            <button
              type="button"
              className="dsh-wsr-picker__save"
              onClick={props.onPickImage}
            >
              <ImageIcon size={14} /> 选择图片…
            </button>
          </div>
        ) : (
          <div className="dsh-wsr-picker__body">
            <input
              className="dsh-wsr-picker__input"
              value={text}
              maxLength={4}
              placeholder="如 DS 或 茶"
              aria-label="缩略图文字"
              onChange={(event) => setText(event.target.value)}
            />
            <div className="dsh-wsr-picker__swatches" role="radiogroup" aria-label="文字颜色">
              {PALETTE.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="radio"
                  aria-checked={color === entry}
                  aria-label={`颜色 ${entry}`}
                  className={`dsh-wsr-picker__swatch${color === entry ? " dsh-wsr-picker__swatch--on" : ""}`}
                  style={{ background: entry }}
                  onClick={() => setColor(entry)}
                >
                  {color === entry && <CheckIcon size={11} />}
                </button>
              ))}
              <label
                className={`dsh-wsr-picker__swatch dsh-wsr-picker__swatch--custom${isCustomColor(color) ? " dsh-wsr-picker__swatch--on" : ""}`}
                style={{ background: isCustomColor(color) ? color : undefined }}
                title="自定义颜色"
              >
                <input
                  type="color"
                  value={isCustomColor(color) ? color : (PALETTE[0] as string)}
                  onChange={(event) => setColor(event.target.value)}
                />
              </label>
            </div>
            <div className="dsh-wsr-picker__previewrow">
              <div className="dsh-wsr-picker__preview" style={{ opacity: previewGhost ? 0.45 : 1 }}>
                <TextTile text={previewText} color={color} />
              </div>
              <button
                type="button"
                className="dsh-wsr-picker__save"
                disabled={!canSave}
                onClick={() => props.onSaveText(trimmed, color)}
              >
                <CheckIcon size={14} /> 保存
              </button>
            </div>
          </div>
        )}

        {props.current !== undefined && (
          <div className="dsh-wsr-picker__foot">
            <button
              type="button"
              className="dsh-wsr-picker__remove"
              onClick={props.onRemove}
            >
              <TrashIcon size={13} /> 移除当前缩略图
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Whether the color is a user-picked value outside the palette. */
function isCustomColor(color: string): boolean {
  return !(PALETTE as readonly string[]).includes(color);
}
