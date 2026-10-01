import { describe, expect, it, vi } from "vitest";
import { ANALYZE_ENDPOINT, ANALYZE_FIELDS, PROBLEM_REASONS, type AnalyzeFields } from "@/domain/food/analyzeTypes";
import { sendAnalyze } from "./sendAnalyze";

const REQUEST_ID = "6f1f0c52-3a5e-4c9e-9d2a-0f3b2f7c9a11";
const REPORT_ID = "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718";

const textFields: AnalyzeFields = { mode: "text", text: "bread and cheese", requestId: REQUEST_ID, composedMs: 4200 };

function respond(body: unknown, init: { status?: number; redirected?: boolean; url?: string } = {}): Response {
  const response = new Response(typeof body === "string" ? body : JSON.stringify(body), { status: init.status ?? 200 });
  Object.defineProperty(response, "redirected", { value: init.redirected ?? false });
  Object.defineProperty(response, "url", { value: init.url ?? `http://localhost${ANALYZE_ENDPOINT}` });
  return response;
}

const signal = () => new AbortController().signal;

describe("sendAnalyze", () => {
  it("posts multipart form data to the endpoint with the agreed field names and no Content-Type header", async () => {
    const fetchImpl = vi.fn(async () => respond({ ok: true, id: REPORT_ID, redirectTo: `/report/food/${REPORT_ID}` }));
    await sendAnalyze({ fields: textFields, image: null }, { signal: signal(), fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ANALYZE_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toBeUndefined();

    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get(ANALYZE_FIELDS.mode)).toBe("text");
    expect(body.get(ANALYZE_FIELDS.text)).toBe("bread and cheese");
    expect(body.get(ANALYZE_FIELDS.requestId)).toBe(REQUEST_ID);
    expect(body.get(ANALYZE_FIELDS.composedMs)).toBe("4200");
    expect(body.has(ANALYZE_FIELDS.image)).toBe(false);
  });

  it("sends the photo as a file named meal.jpg of type image/jpeg", async () => {
    const fetchImpl = vi.fn(async () => respond({ ok: true, id: REPORT_ID, redirectTo: `/report/food/${REPORT_ID}` }));
    const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    await sendAnalyze(
      { fields: { mode: "photo", text: "", requestId: REQUEST_ID, composedMs: null }, image },
      { signal: signal(), fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const body = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    const file = body.get(ANALYZE_FIELDS.image) as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("meal.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(3);
    // composedMs is left out when unknown.
    expect(body.has(ANALYZE_FIELDS.composedMs)).toBe(false);
  });

  it("passes the abort signal to fetch", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => respond({ ok: false, reason: "ai_error" }));
    await sendAnalyze({ fields: textFields, image: null }, { signal: controller.signal, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(controller.signal);
  });

  it("returns the report to open when the server says ok", async () => {
    const fetchImpl = async () => respond({ ok: true, id: REPORT_ID, redirectTo: `/report/food/${REPORT_ID}` });
    await expect(
      sendAnalyze({ fields: textFields, image: null }, { signal: signal(), fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: true, id: REPORT_ID, redirectTo: `/report/food/${REPORT_ID}` });
  });

  it.each(PROBLEM_REASONS.filter((reason) => reason !== "network"))("passes the server reason %s through", async (reason) => {
    const fetchImpl = async () => respond({ ok: false, reason }, { status: reason === "not_signed_in" ? 401 : 200 });
    await expect(
      sendAnalyze({ fields: textFields, image: null }, { signal: signal(), fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason });
  });

  it("passes quiet_time through, for the caller to turn into a navigation", async () => {
    const fetchImpl = async () => respond({ ok: false, reason: "quiet_time" });
    await expect(
      sendAnalyze({ fields: textFields, image: null }, { signal: signal(), fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason: "quiet_time" });
  });

  it("does not trust a server body that names the client-side reason or an unknown one", async () => {
    for (const reason of ["network", "made_up", 7]) {
      const fetchImpl = async () => respond({ ok: false, reason });
      await expect(
        sendAnalyze({ fields: textFields, image: null }, { signal: signal(), fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).resolves.toEqual({ ok: false, reason: "network" });
    }
  });

  it("refuses to navigate anywhere but a food report", async () => {
    for (const redirectTo of ["https://evil.example/", "//evil.example", "/", "/report/food/abc/../../x", "/report/food", 5]) {
      const fetchImpl = async () => respond({ ok: true, id: REPORT_ID, redirectTo });
      await expect(
        sendAnalyze({ fields: textFields, image: null }, { signal: signal(), fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).resolves.toEqual({ ok: false, reason: "network" });
    }
  });

  it("maps a non-JSON 413 to too_large and a non-JSON 401 to not_signed_in", async () => {
    const send = (status: number) =>
      sendAnalyze(
        { fields: textFields, image: null },
        { signal: signal(), fetchImpl: (async () => respond("Request Entity Too Large", { status })) as unknown as typeof fetch },
      );
    await expect(send(413)).resolves.toEqual({ ok: false, reason: "too_large" });
    await expect(send(401)).resolves.toEqual({ ok: false, reason: "not_signed_in" });
  });

  it("maps a platform error page (non-JSON 504, 502, 500) to network", async () => {
    for (const status of [500, 502, 504]) {
      const fetchImpl = async () => respond("<html>Gateway Timeout</html>", { status });
      await expect(
        sendAnalyze({ fields: textFields, image: null }, { signal: signal(), fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).resolves.toEqual({ ok: false, reason: "network" });
    }
  });

  it("maps a redirect to /login (the proxy answering an expired session) to not_signed_in", async () => {
    const fetchImpl = async () => respond("<html>login</html>", { redirected: true, url: "http://localhost/login" });
    await expect(
      sendAnalyze({ fields: textFields, image: null }, { signal: signal(), fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason: "not_signed_in" });
  });

  it("maps a rejected fetch to network", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(
      sendAnalyze({ fields: textFields, image: null }, { signal: signal(), fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason: "network" });
  });

  it("resolves (never rejects) when the request is aborted; the caller checks the signal", async () => {
    const controller = new AbortController();
    const fetchImpl = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const pending = sendAnalyze({ fields: textFields, image: null }, { signal: controller.signal, fetchImpl: fetchImpl as unknown as typeof fetch });
    controller.abort();
    await expect(pending).resolves.toEqual({ ok: false, reason: "network" });
    expect(controller.signal.aborted).toBe(true);
  });
});
