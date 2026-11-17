"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bell, Clock, Eye, Folder, Home, Library as LibraryIcon, Play, Search, Settings, Users } from "lucide-react";
import { Logo, LogoMark } from "./Logo";
import { RecordButton } from "./RecordButton";
import { formatTime, initials, timeAgo } from "@/lib/format";
import { OWNER_NAME } from "@/lib/config";

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
}: {
  videos: LibraryVideo[];
  storage: "local" | "supabase";
  aiEnabled: boolean;
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
        <a className="nav-item">
          <Home size={18} /> Inicio
        </a>
        <Link href="/" className="nav-item active">
          <LibraryIcon size={18} /> Mi biblioteca
        </Link>
        <a className="nav-item">
          <Bell size={18} /> Notificaciones
        </a>
        <div className="nav-section">Espacios</div>
        <a className="nav-item">
          <Users size={18} /> Todo el equipo
        </a>
        <a className="nav-item">
          <Clock size={18} /> Ver más tarde
        </a>
        <a className="nav-item">
          <Settings size={18} /> Configuración
        </a>
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
          <span className="tab">
            <Folder size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
            Carpetas
          </span>
          <span className="tab">Archivo</span>
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
      </main>
    </div>
  );
}
