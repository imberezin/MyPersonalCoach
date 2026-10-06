import { cropKey, type CropRect } from "@/domain/food/crop";

/**
 * The key that decides which request id a photo send carries (`createRequestIds().idFor("photo", key)`): the same key keeps
 * the same id, so a retry after a dropped answer is recognized by the server and answered from the stored report; a
 * different key is a new id. A photo report is made of the picture AND the note, and the picture is the photo AND the frame
 * cut from it, so all three are in the key: "send, change the frame, send again" must never be answered with the first
 * picture's report.
 */
export function photoRequestKey(seq: number, frame: CropRect, note: string): string {
  return `photo:${seq}:${cropKey(frame)}:${note}`;
}
