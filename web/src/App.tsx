import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect } from "react";
import { useKin } from "./lib/store";
import { boot, markSeenIfVisible } from "./lib/actions";
import { Chat } from "./screens/Chat";
import { Today } from "./screens/Today";
import { Goals } from "./screens/Goals";
import { Library } from "./screens/Library";
import { ProfileSheet } from "./screens/Profile";
import { RunDetail } from "./screens/RunDetail";
import { Onboarding } from "./screens/Onboarding";
import { SignIn } from "./screens/SignIn";
import { TabBar } from "./components/TabBar";
import { Avatar } from "./components/Avatar";
import { Sidebar } from "./components/Sidebar";
import { useWide } from "./lib/viewport";

function Toast() {
  const t = useKin((s) => s.toast);
  return (
    <AnimatePresence>
      {t && (
        <motion.div
          key={t.id}
          className="toast"
          role="status"
          initial={{ opacity: 0, y: -16, x: "-50%", scale: 0.95 }}
          animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
          exit={{ opacity: 0, y: -16, x: "-50%", scale: 0.95 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        >
          {t.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Splash() {
  const agent = useKin((s) => s.agent);
  return (
    <div className="screen splash">
      <Avatar config={agent.avatar} state="asleep" size={96} ground />
    </div>
  );
}

function ErrorScreen() {
  const msg = useKin((s) => s.bootError);
  return (
    <div className="screen splash">
      <div className="empty">
        <h3>Can't reach Kin</h3>
        <p>{msg ?? "The server didn't answer."}</p>
        <button type="button" className="btn btn-ink" style={{ marginTop: 16 }} onClick={() => boot()}>
          Try again
        </button>
      </div>
    </div>
  );
}

function Tabs() {
  const tab = useKin((s) => s.tab);
  const wide = useWide();
  return (
    <>
      {wide && <Sidebar />}
      {/* Chat stays mounted so scroll position and drafts survive tab switches. */}
      <div className="tab-panel" hidden={tab !== "chat"}>
        <Chat />
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        {tab !== "chat" && (
          <motion.div
            key={tab}
            className="tab-panel"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {tab === "today" ? <Today /> : tab === "goals" ? <Goals /> : <Library />}
          </motion.div>
        )}
      </AnimatePresence>
      {!wide && <TabBar />}
    </>
  );
}

export function App() {
  const phase = useKin((s) => s.phase);
  const depth = useKin((s) => s.sheetDepth);
  // On a wide screen the signed-in app lays out like Messages on a Mac; sign-in and
  // onboarding keep the phone-sized card.
  const desktop = useWide() && phase === "app";

  useEffect(() => {
    boot();
    const onVis = () => {
      if (document.visibilityState === "visible") markSeenIfVisible(useKin.getState().activeThreadId);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <MotionConfig reducedMotion="never">
      <div className="stage">
        <div className={`app ${desktop ? "desktop" : ""}`}>
          <motion.div
            className="app-content"
            animate={depth > 0 && !desktop ? { scale: 0.93, y: 10, borderRadius: 18 } : { scale: 1, y: 0, borderRadius: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
          >
            {/* Phases are stacked and crossfade; "wait" mode can stall when phases change in quick succession. */}
            <AnimatePresence initial={false}>
              <motion.div
                key={phase}
                className="phase"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                {phase === "boot" && <Splash />}
                {phase === "signin" && <SignIn />}
                {phase === "onboarding" && <Onboarding />}
                {phase === "error" && <ErrorScreen />}
                {phase === "app" && <Tabs />}
              </motion.div>
            </AnimatePresence>
          </motion.div>
          <div id="overlay-root" />
          <div id="sheet-root" />
          {phase === "app" && (
            <>
              <ProfileSheet />
              <RunDetail />
            </>
          )}
          <Toast />
        </div>
      </div>
    </MotionConfig>
  );
}
