import { describe, expect, it } from "vitest";
import { FULL_CROP } from "@/domain/food/crop";
import { photoRequestKey } from "./photoRequest";
import { createRequestIds } from "./requestId";

const frame = { x: 0.2, y: 0.1, w: 0.5, h: 0.6 };

describe("photoRequestKey", () => {
  it("is the same for the same photo, frame and note", () => {
    expect(photoRequestKey(3, frame, "no sauce")).toBe(photoRequestKey(3, { ...frame }, "no sauce"));
  });

  it("differs for another photo, another frame or another note", () => {
    const base = photoRequestKey(3, frame, "no sauce");
    expect(photoRequestKey(4, frame, "no sauce")).not.toBe(base);
    expect(photoRequestKey(3, { ...frame, w: 0.51 }, "no sauce")).not.toBe(base);
    expect(photoRequestKey(3, frame, "no sauce, half")).not.toBe(base);
    expect(photoRequestKey(3, FULL_CROP, "no sauce")).not.toBe(base);
  });

  it("treats a frame a hair short of the whole picture as the whole picture, since that is what is sent", () => {
    expect(photoRequestKey(1, { x: 0.002, y: 0, w: 0.997, h: 1 }, "")).toBe(photoRequestKey(1, FULL_CROP, ""));
  });

  it("keeps a note with a colon from being mistaken for another frame or photo", () => {
    expect(photoRequestKey(1, FULL_CROP, "full:2")).not.toBe(photoRequestKey(1, FULL_CROP, "2"));
  });
});

describe("a photo send's request id, as the screen asks for it", () => {
  let n = 0;
  const ids = () => createRequestIds(() => `id-${++n}`);

  it("keeps the id across a retry of the very same picture", () => {
    const requestIds = ids();
    const first = requestIds.idFor("photo", photoRequestKey(1, frame, "x"));
    expect(requestIds.idFor("photo", photoRequestKey(1, frame, "x"))).toBe(first);
  });

  it("gives a new id when the frame changed after the first send, so the server never answers with the first picture's report", () => {
    const requestIds = ids();
    const first = requestIds.idFor("photo", photoRequestKey(1, frame, "x"));
    const second = requestIds.idFor("photo", photoRequestKey(1, { ...frame, x: 0.25 }, "x"));
    expect(second).not.toBe(first);
  });

  it("gives a new id for the whole picture after a cropped send of the same photo", () => {
    const requestIds = ids();
    const cropped = requestIds.idFor("photo", photoRequestKey(1, frame, ""));
    expect(requestIds.idFor("photo", photoRequestKey(1, FULL_CROP, ""))).not.toBe(cropped);
  });
});
