import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initClient, isMock } from "./lib/client";
import { trackViewport } from "./lib/viewport";
import { applyAccent } from "./lib/color";
import { DEFAULT_AGENT } from "./lib/store";
import "@fontsource-variable/inter/opsz.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/avatar.css";
import "./styles/chat.css";
import "./styles/sheets.css";
import "./styles/screens.css";
import "./styles/onboarding.css";
import "./styles/desktop.css";

// SF Pro comes with Apple devices but can also be installed elsewhere; without it the stack
// falls to Inter, which wants lighter tracking. Detect the font itself, not the platform.
function hasSF() {
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const width = (family: string) => {
    c.font = `40px ${family}, monospace`;
    return c.measureText("Saturday looks great Wg").width;
  };
  const base = width("monospace");
  return ["-apple-system", "BlinkMacSystemFont", '"SF Pro Text"'].some((f) => width(f) !== base);
}
document.documentElement.classList.toggle("no-sf", !hasSF());

applyAccent(DEFAULT_AGENT.avatar.color);
trackViewport();

if ("serviceWorker" in navigator && import.meta.env.PROD && !isMock) {
  // A new deploy's worker takes over in the background (skipWaiting), but the open page would
  // keep running the old code until the next launch. Reload once when that happens, and check
  // for a new version whenever the app comes back to the foreground. Drafts live in storage.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((reg) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

const gallery = import.meta.env.DEV && new URLSearchParams(location.search).has("gallery");

initClient().then(async () => {
  const Root = gallery ? (await import("./screens/AvatarGallery")).AvatarGallery : App;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
});
