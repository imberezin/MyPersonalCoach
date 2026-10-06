"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import {
  CROP_CORNERS,
  CROP_EDGES,
  dragCrop,
  isFullCrop,
  nudgeCrop,
  type CropHandle,
  type CropKey,
  type CropRect,
} from "@/domain/food/crop";
import styles from "./food.module.css";

const ARROW_KEYS: readonly string[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

/** What one drag remembers: where it started and how big the picture was, so the frame is a pure function of both. */
interface Drag {
  pointerId: number;
  handle: CropHandle;
  startX: number;
  startY: number;
  start: CropRect;
  width: number;
  height: number;
}

/** A share of the picture as a CSS percentage, without float dust. */
const pct = (share: number): string => `${Math.round(share * 10_000) / 100}%`;

export interface CropFrameProps {
  /** The picture's width divided by its height: the frame area takes exactly the picture's shape, so the numbers are exact. */
  aspect: number;
  crop: CropRect;
  onChange: (next: CropRect) => void;
  /** False while the photo is on its way: the frame is shown but cannot be moved. */
  interactive: boolean;
  /** The id of the line that explains the frame; every corner points at it. */
  hintId: string;
  /** The picture itself. */
  children: ReactNode;
}

/**
 * The crop frame of the photo screen (D2): a free rectangle on the picture, always there, that starts as the whole
 * picture. Four corners are buttons (touch, mouse, and the arrow keys), the four edges and the inside of the frame are
 * touch-and-mouse only (the corners already reach every edge from the keyboard). All the arithmetic is the pure
 * `domain/food/crop`; this component only turns pointer movement into shares of the picture.
 *
 * The picture is never mirrored, so the frame is placed with physical `left` and `top` in inline styles, whatever the
 * direction of the page (the style sheet itself may use logical properties only). The area is `dir="ltr"` for the same reason.
 * While the frame is the whole picture the inside does not capture touches, so the page can still be scrolled with a
 * finger on the picture.
 */
export function CropFrame({ aspect, crop, onChange, interactive, hintId, children }: CropFrameProps) {
  const t = useTranslations("food");
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** A finger is moving the frame, or a corner has the keyboard: the thirds grid shows, as in the photo editors people know. */
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const full = isFullCrop(crop);

  const box: CSSProperties = { left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) };
  const stageStyle = { "--aspect": String(Number.isFinite(aspect) && aspect > 0 ? aspect : 1) } as CSSProperties;

  function begin(event: PointerEvent<HTMLElement>, handle: CropHandle) {
    if (!interactive) return;
    // Only the main button of a mouse; a finger or a pen always has pointerType "touch" or "pen".
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const area = stage.current?.getBoundingClientRect();
    if (!area || area.width <= 0 || area.height <= 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone: the drag simply does not start.
      return;
    }
    drag.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      start: crop,
      width: area.width,
      height: area.height,
    };
    setDragging(true);
  }

  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    onChange(
      dragCrop(
        current.start,
        current.handle,
        (event.clientX - current.startX) / current.width,
        (event.clientY - current.startY) / current.height,
      ),
    );
  }

  function end(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null;
      setDragging(false);
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Nothing was captured any more.
    }
  }

  function onKeyDown(handle: CropHandle) {
    return (event: KeyboardEvent<HTMLElement>) => {
      if (!interactive || !ARROW_KEYS.includes(event.key)) return;
      event.preventDefault();
      onChange(nudgeCrop(crop, handle, event.key as CropKey));
    };
  }

  const right = crop.x + crop.w;
  const bottom = crop.y + crop.h;
  const cornerStyle = (corner: (typeof CROP_CORNERS)[number]): CSSProperties => ({
    left: pct(corner.includes("w") ? crop.x : right),
    top: pct(corner.includes("n") ? crop.y : bottom),
  });
  const edgeStyle = (edge: (typeof CROP_EDGES)[number]): CSSProperties => {
    if (edge === "n") return { left: pct(crop.x), top: pct(crop.y), width: pct(crop.w) };
    if (edge === "s") return { left: pct(crop.x), top: pct(bottom), width: pct(crop.w) };
    if (edge === "w") return { left: pct(crop.x), top: pct(crop.y), height: pct(crop.h) };
    return { left: pct(right), top: pct(crop.y), height: pct(crop.h) };
  };

  return (
    <div ref={stage} className={styles.cropStage} style={stageStyle} dir="ltr">
      {children}
      {/* The dimming outside the frame and the frame's own line: looks only, never takes a touch. */}
      <div className={styles.cropClip} aria-hidden="true">
        <div className={styles.cropBox} style={box} data-active={dragging || focused ? "true" : "false"} />
      </div>
      {interactive ? (
        <div
          className={styles.cropHandles}
          role="group"
          aria-label={t("photo.cropFrame")}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          {full ? null : (
            <div
              className={styles.cropMove}
              style={box}
              aria-hidden="true"
              onPointerDown={(event) => begin(event, "move")}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          )}
          {CROP_EDGES.map((edge) => (
            <div
              key={edge}
              className={edge === "n" || edge === "s" ? styles.cropEdgeH : styles.cropEdgeV}
              style={edgeStyle(edge)}
              aria-hidden="true"
              onPointerDown={(event) => begin(event, edge)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          ))}
          {CROP_CORNERS.map((corner) => (
            <button
              key={corner}
              type="button"
              className={styles.cropHandle}
              data-corner={corner}
              style={cornerStyle(corner)}
              aria-label={t(`photo.cropCorner.${corner}`)}
              aria-describedby={hintId}
              onKeyDown={onKeyDown(corner)}
              onPointerDown={(event) => begin(event, corner)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
