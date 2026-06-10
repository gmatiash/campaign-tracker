// src/app/auth/SignIn.tsx
import { useState } from "react";
import { supabase } from "../../core/persistence/supabase/supabaseClient";

const C = { panel: "#13161f", border: "#2b3142", text: "#e9e3d4", dim: "#99a0b0", gold: "#d4af37" };

/** Passwordless email magic-link sign-in. Shown only in cloud mode when signed out. */
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const send = async () => {
    if (!supabase || !email.trim()) return;
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href },
    });
    if (error) { setStatus("error"); setMessage(error.message); }
    else { setStatus("sent"); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0c11", color: C.text, fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 360, maxWidth: "100%", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
        <h1 style={{ fontSize: 20, color: C.gold, margin: "0 0 4px" }}>Campaign Tracker</h1>
        <p style={{ fontSize: 12, color: C.dim, marginTop: 0 }}>Sign in to sync your campaign across devices.</p>

        {status === "sent" ? (
          <p style={{ fontSize: 13, color: C.text }}>
            Check <strong>{email}</strong> for a sign-in link, then return to this tab.
          </p>
        ) : (
          <>
            <input
              type="email" value={email} placeholder="you@example.com" autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              style={{ width: "100%", boxSizing: "border-box", background: "#0a0c11", color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, marginBottom: 10 }}
            />
            <button
              onClick={send} disabled={status === "sending"}
              style={{ width: "100%", background: C.gold, color: "#0a0c11", border: "none", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontWeight: 800, cursor: "pointer", opacity: status === "sending" ? 0.7 : 1 }}
            >
              {status === "sending" ? "Sending…" : "Email me a link"}
            </button>
            {status === "error" && <p style={{ fontSize: 12, color: "#d9544a" }}>{message}</p>}
          </>
        )}
      </div>
    </div>
  );
}
