"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Eye, Library as LibraryIcon, Play, Search, Settings } from "lucide-react";
import { Logo, LogoMark } from "./Logo";
import { RecordButton } from "./RecordButton";
import { formatTime, initials, timeAgo } from "@/lib/format";
import { OWNER_NAME } from "@/lib/config";
import { RECORDING_MODES, readRecordingMode, saveRecordingMode, type RecordingMode } from "@/lib/recordingPreferences";

export type LibraryVideo = {
  id: string;
  title: string;
  duration_ms: number;
  views: number;
  created_at: string;
  author_name: string;
  thumb: string | null;
  status: string;
};

export function Library({
  videos,
  storage,
  aiEnabled,
  settings,
  passwordEnabled,
}: {
  videos: LibraryVideo[];
  storage: "local" | "supabase";
  aiEnabled: boolean;
  settings: boolean;
  passwordEnabled: boolean;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => videos.filter((v) => v.title.toLowerCase().includes(q.toLowerCase())), [videos, q]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/">
          <Logo size={30} />
        </Link>
        <div className="workspace">
          <span className="avatar avatar-square">{initials(OWNER_NAME)}</span>
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontWeight: 650 }}>{OWNER_NAME}</div>
            <div style={{ fontSize: 12, color: "var(--grey6)" }}>Workspace personal</div>
          </div>
        </div>
        <nav aria-label="Navegación principal">
          <Link href="/" className={`nav-item${settings ? "" : " active"}`} aria-current={settings ? undefined : "page"}>
            <LibraryIcon size={18} /> Mi biblioteca
          </Link>
          <Link href="/?vista=configuracion" className={`nav-item${settings ? " active" : ""}`} aria-current={settings ? "page" : undefined}>
            <Settings size={18} /> Configuración
          </Link>
        </nav>
        <div className="sidebar-foot">
          <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--body)", fontWeight: 650, marginBottom: 4 }}>
            <LogoMark size={18} /> Grabaciones ilimitadas
          </div>
          {storage === "supabase"
            ? "Grabaciones sin límite de duración, guardadas en tu Supabase."
            : "Grabaciones sin límite de duración, guardadas en tu computadora (carpeta .data)."}
        </div>
      </aside>

      <main className="main">
        <nav className="library-mobile-nav" aria-label="Navegación principal">
          <Link href="/" aria-current={settings ? undefined : "page"}>Mi biblioteca</Link>
          <Link href="/?vista=configuracion" aria-current={settings ? "page" : undefined}>Configuración</Link>
        </nav>
        {settings ? <RecorderSettings storage={storage} aiEnabled={aiEnabled} passwordEnabled={passwordEnabled} /> : (
          <>
            <div className="topbar">
              <label className="search">
                <Search size={16} />
                <input placeholder="Buscar videos" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <span style={{ flex: 1 }} />
              <RecordButton />
              <span className="avatar">{initials(OWNER_NAME)}</span>
            </div>

            {(!aiEnabled || storage === "local") && (
              <div
                style={{
                  margin: "0 0 16px",
                  padding: "10px 14px",
                  border: "1px solid var(--border, #2a2a2e)",
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "var(--grey6)",
                  display: "grid",
                  gap: 4,
                }}
              >
                {!aiEnabled && (
                  <div>
                    <strong>Falta GROQ_API_KEY</strong>: puedes grabar y compartir igual, pero la transcripción, el resumen y los
                    capítulos con IA están desactivados. Agrega la clave en <code>.env.local</code> y reinicia <code>npm run dev</code>.
                  </div>
                )}
                {storage === "local" && (
                  <div>
                    Modo local: tus videos se guardan en la carpeta <code>.data</code> y los links solo funcionan en esta computadora.
                    Para compartir en internet configura Supabase (ver README).
                  </div>
                )}
              </div>
            )}

            <h1 className="page-title">Mi biblioteca</h1>
            <div style={{ color: "var(--grey6)" }}>Todas tus grabaciones en un solo lugar.</div>

            <div className="tabs">
              <span className="tab active">
                Videos <span className="count">{videos.length}</span>
              </span>
            </div>

            {list.length === 0 ? (
              <div className="empty">
                <div>
                  <span className="burst" style={{ animationIterationCount: 1 }}>
                    <LogoMark size={44} />
                  </span>
                  <h3>{videos.length ? "Nada coincide con tu búsqueda" : "Grabá tu primer video"}</h3>
                  <p>Grabá tu pantalla y tu cámara, y compartí el link al instante.</p>
                  <RecordButton label="Grabar un video" size="btn-lg" />
                </div>
              </div>
            ) : (
              <div className="grid">
                {list.map((v, i) => (
                  <Link key={v.id} href={`/share/${v.id}`} className="card" style={{ animationDelay: `${i * 40}ms` }}>
                    <div className="thumb">
                      {v.thumb ? <img src={v.thumb} alt="" loading="lazy" /> : null}
                      <div className="thumb-play">
                        <span>
                          <Play size={22} fill="currentColor" />
                        </span>
                      </div>
                      {v.status !== "ready" && <span className="badge badge-left">Procesando</span>}
                      <span className="badge">{formatTime(v.duration_ms / 1000)}</span>
                    </div>
                    <div className="card-title">{v.title}</div>
                    <div className="card-meta">
                      <span className="avatar avatar-sm">{initials(v.author_name)}</span>
                      <span>{v.author_name}</span>
                      <span className="dot-sep">{timeAgo(v.created_at)}</span>
                      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <Eye size={14} /> {v.views}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}


function RecorderSettings({ storage, aiEnabled, passwordEnabled }: {
  storage: "local" | "supabase";
  aiEnabled: boolean;
  passwordEnabled: boolean;
}) {
  const [mode, setMode] = useState<RecordingMode>();

  useEffect(() => {
    setMode(readRecordingMode());
  }, []);

  return (
    <section className="recorder-settings" aria-labelledby="settings-heading">
      <h1 id="settings-heading" className="page-title">Configuración</h1>
      <div className="settings-card">
        <label htmlFor="recording-mode">Modo de grabación</label>
        <p>Se usa al abrir una nueva grabación en este navegador.</p>
        <select
          id="recording-mode"
          value={mode ?? "screen-cam"}
          disabled={mode === undefined}
          onChange={(event) => {
            const next = event.target.value as RecordingMode;
            if (saveRecordingMode(next)) setMode(next);
          }}
        >
          {Object.entries(RECORDING_MODES).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <div className="settings-card">
        <h2>Estado de la app</h2>
        <dl>
          <div><dt>Almacenamiento</dt><dd>{storage === "supabase" ? "Supabase" : "Local"}</dd></div>
          <div><dt>Transcripción con Groq</dt><dd>{aiEnabled ? "Configurada" : "Sin configurar"}</dd></div>
          <div><dt>Contraseña de la biblioteca</dt><dd>{passwordEnabled ? "Configurada" : "Sin configurar"}</dd></div>
        </dl>
      </div>
    </section>
  );
}
