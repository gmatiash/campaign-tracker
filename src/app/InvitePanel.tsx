// src/app/InvitePanel.tsx
import { useState } from "react";
import type { CSSProperties } from "react";

const C = { panel: "#13161f", row: "#1a1e29", border: "#2b3142", text: "#e9e3d4", dim: "#99a0b0", gold: "#d4af37" };

const btn: CSSProperties = {
  background: "#1a1e29", border: "1px solid #2b3142", color: "#e9e3d4",
  borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
};

/**
 * Invite UI. The campaign currently lives at a single URL, so the invite link is
 * just the app URL: anyone who opens it and signs in is added to the campaign as
 * a player (via the ensure_membership RPC during bootstrap). The GM can then
 * promote them in the Members panel.
 */
export default function InvitePanel() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = window.location.origin + window.location.pathname;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (e.g. insecure context) — the field is selectable as a fallback */
    }
  };

  return (
    <>
      <button style={{ ...btn, color: C.gold, borderColor: `${C.gold}66` }} onClick={() => setOpen(true)}>Invite</button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(460px, 92vw)", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, boxShadow: "0 18px 50px rgba(0,0,0,0.6)" }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, color: C.gold, fontSize: 16, fontWeight: 800, flex: 1 }}>Invite players</h3>
              <button style={btn} onClick={() => setOpen(false)}>Close</button>
            </div>

            <p style={{ color: C.dim, fontSize: 12, margin: "0 0 10px", lineHeight: 1.5 }}>
              Share this link. When someone opens it and signs in with their email, they join this
              campaign as a <strong style={{ color: C.text }}>player</strong>. Promote them to GM
              anytime in the Members panel.
            </p>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                readOnly value={link} onFocus={(e) => e.currentTarget.select()}
                style={{ flex: 1, background: C.row, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 9px", fontSize: 12 }}
              />
              <button style={{ ...btn, color: C.gold, borderColor: `${C.gold}66`, whiteSpace: "nowrap" }} onClick={copy}>
                {copied ? "Copied!" : "Copy link"}
              </button>
            </div>

            <p style={{ color: C.dim, fontSize: 11, margin: "10px 0 0" }}>
              Tip: players need an account on this deployment to sign in. The link is the same for
              everyone — there are no separate per-player codes.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
