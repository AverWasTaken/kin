import { useState } from "react";
import { motion } from "motion/react";
import type { AgentState } from "@shared/api";
import { signIn } from "../lib/actions";
import { DEFAULT_AGENT } from "../lib/store";
import { ApiError } from "../lib/api";
import { Avatar } from "../components/Avatar";

export function SignIn() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mood, setMood] = useState<AgentState>("asleep");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    setMood("thinking");
    try {
      await signIn(token);
    } catch (err) {
      setMood("asleep");
      setError(
        err instanceof ApiError && err.status === 401
          ? "That token didn't work. Check it and try again."
          : "Couldn't reach your Kin server.",
      );
    } finally {
      setBusy(false);
    }
  };

  const face: AgentState = mood === "asleep" && token ? "listening" : mood;

  return (
    <div className="screen signin">
      <form className="signin-card" onSubmit={submit}>
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 22 }}>
          <Avatar config={DEFAULT_AGENT.avatar} state={face} size={128} ground />
        </motion.div>
        <h1>Welcome back</h1>
        <p>Enter the owner token from your Kin server to sign in on this device.</p>
        <input
          className="field"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Owner token"
          autoComplete="current-password"
          aria-label="Owner token"
          aria-invalid={!!error}
          autoFocus
        />
        {error && (
          <motion.p className="signin-error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
            {error}
          </motion.p>
        )}
        <button type="submit" className="btn btn-ink btn-block" disabled={busy || !token.trim()}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
