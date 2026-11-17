"use client";

import { useState } from "react";
import { Logo } from "@/components/Logo";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (r.ok) location.href = "/";
    else {
      setErr("Contraseña incorrecta");
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg-secondary)", padding: 16 }}>
      <form className="upload-card" onSubmit={submit} style={{ textAlign: "left" }}>
        <Logo size={34} />
        <h3 style={{ marginTop: 22 }}>Entrá a DRILL Recorder</h3>
        <p>Solo vos podés grabar y ver tu librería. Los links que compartís son públicos.</p>
        <div className="composer" style={{ marginBottom: 12 }}>
          <input type="password" placeholder="Contraseña" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </div>
        {err && <div className="rec-error" style={{ margin: "0 0 12px" }}>{err}</div>}
        <button className="btn btn-primary rec-start" disabled={loading}>
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
