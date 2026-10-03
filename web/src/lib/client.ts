import { httpApi, type KinApi, type KinStream } from "./api";
import { wsStream } from "./stream";

function detectMock(): boolean {
  if (import.meta.env.VITE_MOCK === "1") return true;
  const q = new URLSearchParams(location.search);
  try {
    if (q.get("mock") === "0") sessionStorage.removeItem("kin.mock");
    if (q.get("mock") === "1") sessionStorage.setItem("kin.mock", "1");
    return sessionStorage.getItem("kin.mock") === "1";
  } catch {
    return q.get("mock") === "1";
  }
}

export const isMock = detectMock();

export let api: KinApi = httpApi;
export let stream: KinStream = wsStream;

/** Swaps in the mock backend when requested. The mock lives in its own chunk. */
export async function initClient() {
  if (!isMock) return;
  const m = await import("../mock/mockApi");
  api = m.mockApi;
  stream = m.mockStream;
}
