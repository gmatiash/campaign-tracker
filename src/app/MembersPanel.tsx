// src/app/MembersPanel.tsx
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "../core/persistence/supabase/supabaseClient";

const C = { panel: "#13161f", row: "#1a1e29", border: "#2b3142", text: "#e9e3d4", dim: "#99a0b0", gold: "#d4af37", danger: "#d9544a" };

interface Member {
  user_id: string;
  role: "gm" | "player";
  display_name: string | null;
}

export default function MembersPanel({ campaignId, currentUserId }: { campaignId: string; currentUserId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("campaign_members")
      .select("user_id, role, display_name")
      .eq("campaign_id", campaignId)
      .order("role", { ascending: true });
    if (error) setErr(error.message);
    else { setMembers((data ?? []) as Member[]); setErr(""); }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  const myRole = members.find((m) => m.user_id === currentUserId)?.role;
  const isGm = myRole === "gm";

  const setRole = async (target: string, role: "gm" | "player") => {
    if (!supabase) return;
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("set_member_role", { cid: campaignId, target, new_role: role });
    if (error) setErr(error.message);
    await load();
    setBusy(false);
  };

  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked; ignore */ }
  };

  const btn = (color: string): CSSProperties => ({
    background: C.row, border: `1px solid ${C.border}`, color, borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer",
  });

  return (
    <div style={{ marginTop: 12, maxWidth: 520, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open) void load(); }}
        style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", color: C.text, padding: "8px 12px", fontSize: 13, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
      >
        <span style={{ color: C.gold }}>{open ? "▾" : "▸"}</span>
        Members ({members.length}){myRole ? ` · you are ${myRole.toUpperCase()}` : ""}
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {members.map((m) => {
              const self = m.user_id === currentUserId;
              return (
                <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ flex: 1, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.display_name || m.user_id.slice(0, 8)}{self ? " (you)" : ""}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 800, color: m.role === "gm" ? C.gold : C.dim, border: `1px solid ${m.role === "gm" ? C.gold : C.border}55`, borderRadius: 4, padding: "2px 6px" }}>
                    {m.role.toUpperCase()}
                  </span>
                  {isGm && (
                    m.role === "gm"
                      ? <button disabled={busy} style={btn(C.dim)} onClick={() => setRole(m.user_id, "player")}>Make player</button>
                      : <button disabled={busy} style={btn(C.gold)} onClick={() => setRole(m.user_id, "gm")}>Make GM</button>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.dim }}>
            <button style={btn(C.text)} onClick={copyInvite}>{copied ? "Copied!" : "Copy invite link"}</button>
            <span style={{ marginLeft: 8 }}>Anyone who opens this link and signs in joins as a player; promote them here.</span>
          </div>

          {err && <p style={{ fontSize: 11, color: C.danger, marginBottom: 0 }}>{err}</p>}
        </div>
      )}
    </div>
  );
}
