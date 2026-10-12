import { afterEach, expect, it, vi } from "vitest";
import { createPreviewLoader } from "./public/preview-loader.js";

afterEach(() => vi.unstubAllGlobals());

it.each(["resolve", "reject"])(
  "ignores a stale Working %s after Approved is selected",
  async (outcome) => {
    let srcdoc = "";
    const frame = {
      dataset: {},
      isConnected: true,
      title: "",
      get srcdoc() {
        return srcdoc;
      },
      set srcdoc(value) {
        srcdoc = value;
        queueMicrotask(() => this.onload());
      },
      addEventListener(_event, listener) {
        this.onload = listener;
      },
      setAttribute() {},
      removeAttribute() {},
    };
    vi.stubGlobal("document", { querySelector: () => frame });
    const working = Promise.withResolvers();
    const notify = vi.fn();
    const load = createPreviewLoader(
      () => "pub_test",
      (mode) => (mode === "working" ? working.promise : Promise.resolve({ html: "approved" })),
      notify,
    );
    const pending = load("working");
    await load("approved");
    if (outcome === "resolve") working.resolve({ html: "stale working" });
    else working.reject(new Error("stale error"));
    await pending;
    expect(frame.srcdoc).toBe("approved");
    expect(frame.title).toBe("Sandboxed public approved preview");
    expect(notify).not.toHaveBeenCalled();
  },
);
