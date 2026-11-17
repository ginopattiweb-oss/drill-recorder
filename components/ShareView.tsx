"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronsRight,
  Download,
  Link2,
  MessageSquareText,
  SmilePlus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Logo } from "./Logo";
import { Player, type PlayerHandle } from "./Player";
import { RecordFab, RecordButton } from "./RecordButton";
import { formatTime, initials, timeAgo } from "@/lib/format";
import type { RecorderComment, RecorderReaction, RecorderVideo } from "@/lib/supabase";

const QUICK = ["❤️", "👍", "🔥", "👏", "🙌", "👀"];
const MORE = [
  "💯",
  "🎉",
  "✅",
  "❌",
  "✨",
  "🚀",
  "🙏",
  "😆",
  "🤔",
  "😱",
  "👋",
  "🌈",
  "🐞",
  "💡",
  "😍",
  "🤯",
];

export function ShareView(props: {
  video: RecorderVideo;
  comments: RecorderComment[];
  reactions: RecorderReaction[];
  urls: string[];
  poster: string | null;
  downloadUrl: string | null;
  isOwner: boolean;
  aiEnabled: boolean;
}) {
  const { isOwner, aiEnabled } = props;
  const router = useRouter();
  const [video, setVideo] = useState(props.video);
  const [comments, setComments] = useState(props.comments);
  const [reactions, setReactions] = useState(props.reactions);
  const [title, setTitle] = useState(props.video.title);
  const [views, setViews] = useState(props.video.views);
  const [tab, setTab] = useState<"activity" | "transcript">("activity");
  const [layout, setLayout] = useState<"" | "collapsed" | "theatre">("");
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [floats, setFloats] = useState<
    { id: number; emoji: string; left: number; rot: number }[]
  >([]);
  const [popKey, setPopKey] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [time, setTime] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const playerRef = useRef<PlayerHandle>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/share/${video.id}`,
      );
      setCopied(true);
      showToast("Link copiado al portapapeles");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast("No se pudo copiar el link");
    }
  }, [video.id]);

  // vista + toast de "nuevo video"
  useEffect(() => {
    try {
      setName(localStorage.getItem("drill:name") || "");
    } catch {}
    const key = `drill:viewed:${video.id}`;
    let seen = false;
    try {
      seen = !!sessionStorage.getItem(key);
      sessionStorage.setItem(key, "1");
    } catch {}
    if (!seen)
      fetch(`/api/videos/${video.id}/view`, { method: "POST" })
        .then((r) => r.json())
        .then((d) => d.views && setViews(d.views))
        .catch(() => {});
    const params = new URLSearchParams(location.search);
    if (params.get("new")) {
      navigator.clipboard
        ?.writeText(`${location.origin}/share/${video.id}`)
        .catch(() => {})
        .finally(() =>
          showToast("¡Tu video está listo! Link copiado al portapapeles"),
        );
      history.replaceState(null, "", `/share/${video.id}`);
    }
  }, [video.id]);

  // polling mientras se genera la transcripción / resumen con IA
  const recent = Date.now() - new Date(video.created_at).getTime() < 5 * 60_000;
  const pending =
    aiEnabled &&
    (video.transcript_status === "processing" ||
      (video.transcript_status === "none" && recent));
  useEffect(() => {
    if (!pending) return;
    const i = setInterval(async () => {
      const r = await fetch(`/api/videos/${video.id}`);
      if (!r.ok) return;
      const d = await r.json();
      setVideo(d.video);
      if (
        d.video.title !== video.title &&
        document.activeElement?.className !== "title-input"
      )
        setTitle(d.video.title);
    }, 4000);
    return () => clearInterval(i);
  }, [pending, video.id, video.title]);

  const saveTitle = async () => {
    const t = title.trim();
    if (!t || t === video.title) return setTitle(video.title);
    setVideo((v) => ({ ...v, title: t }));
    await fetch(`/api/videos/${video.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t }),
    });
    showToast("Título actualizado");
  };

  const react = useCallback(
    async (emoji: string) => {
      const ts = Math.round((playerRef.current?.time() ?? 0) * 1000);
      const id = Date.now() + Math.random();
      setFloats((f) => [
        ...f,
        {
          id,
          emoji,
          left: 40 + Math.random() * 20,
          rot: Math.random() * 30 - 15,
        },
      ]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1700);
      setPopKey(emoji + id);
      const temp: RecorderReaction = {
        id: `tmp-${id}`,
        video_id: video.id,
        emoji,
        timestamp_ms: ts,
        created_at: new Date().toISOString(),
      };
      setReactions((r) => [...r, temp]);
      const r = await fetch(`/api/videos/${video.id}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji, timestampMs: ts }),
      });
      if (r.ok) {
        const saved = await r.json();
        setReactions((rs) => rs.map((x) => (x.id === temp.id ? saved : x)));
      }
    },
    [video.id],
  );

  const focusComment = useCallback(() => {
    setLayout((l) => (l === "" ? l : ""));
    setTab("activity");
    setTimeout(() => composerRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        focusComment();
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 6) react(QUICK[n - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusComment, react]);

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const author = name || "Anonymous";
    setDraft("");
    const r = await fetch(`/api/videos/${video.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body,
        authorName: author,
        timestampMs: Math.round(time * 1000),
      }),
    });
    if (r.ok) {
      const saved = (await r.json()) as RecorderComment;
      setComments((c) => [...c, saved]);
    }
  };

  const del = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  };

  // auto-scroll del transcript al segmento actual
  const currentSeg =
    video.transcript?.findIndex((s) => time >= s.start && time < s.end + 0.3) ??
    -1;
  useEffect(() => {
    if (tab !== "transcript" || currentSeg < 0) return;
    transcriptRef.current
      ?.querySelector(".current")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentSeg, tab]);

  const activity = [
    ...comments.map((c) => ({ kind: "comment" as const, ...c })),
    ...reactions.map((r) => ({ kind: "reaction" as const, ...r })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const currentChapter =
    video.chapters?.reduce((acc, c, i) => (time >= c.start ? i : acc), -1) ??
    -1;

  return (
    <>
      <nav className="share-nav">
        <Link href="/">
          <Logo size={30} />
        </Link>
        <span className="spacer" />
        <Link href="/" className="link">
          Mi biblioteca
        </Link>
        <RecordButton
          label="Grabar un video"
          size="btn-sm"
          href={isOwner ? undefined : "/login"}
        />
      </nav>

      <div className={`share-layout ${layout}`}>
        <div className="share-main">
          <div className="share-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              {isOwner ? (
                <input
                  className="title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) =>
                    e.key === "Enter" && (e.target as HTMLInputElement).blur()
                  }
                  aria-label="Título del video"
                />
              ) : (
                <h1>{video.title}</h1>
              )}
              <div className="byline">
                <span className="avatar avatar-sm">
                  {initials(video.author_name)}
                </span>
                <strong>{video.author_name}</strong>
                <span className="dot-sep">{timeAgo(video.created_at)}</span>
              </div>
            </div>
            <span className="views">
              {views} {views === 1 ? "vista" : "vistas"}
            </span>
            <button
              className="icon-btn"
              onClick={copyLink}
              data-tip={copied ? "¡Copiado!" : "Copiar link"}
              aria-label="Copy link"
            >
              {copied ? (
                <Check size={19} color="var(--primary)" />
              ) : (
                <Link2 size={19} />
              )}
            </button>
            {props.downloadUrl && (
              <a
                className="icon-btn"
                href={props.downloadUrl}
                data-tip="Descargar"
                aria-label="Download"
              >
                <Download size={19} />
              </a>
            )}
            {isOwner && (
              <button
                className="icon-btn"
                onClick={del}
                data-tip={
                  confirmDelete ? "Click de nuevo para borrar" : "Borrar"
                }
                style={
                  confirmDelete
                    ? { color: "var(--red)", background: "hsl(4,100%,96%)" }
                    : undefined
                }
                aria-label="Delete"
              >
                <Trash2 size={18} />
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={copyLink}>
              <Link2 size={16} /> Compartir
            </button>
          </div>

          <div className="stage">
            <div className="stage-inner">
              <div style={{ position: "relative" }}>
                <Player
                  ref={playerRef}
                  urls={props.urls}
                  mime={video.mime_type}
                  durationMs={video.duration_ms}
                  poster={props.poster}
                  transcript={video.transcript}
                  chapters={video.chapters}
                  reactions={reactions}
                  onTime={setTime}
                  onTheatre={() =>
                    setLayout((l) => (l === "theatre" ? "" : "theatre"))
                  }
                />
                {floats.map((f) => (
                  <span
                    key={f.id}
                    className="float-emoji"
                    style={{
                      left: `${f.left}%`,
                      ["--rot" as string]: `${f.rot}deg`,
                    }}
                  >
                    {f.emoji}
                  </span>
                ))}
              </div>

              <div className="react-bar">
                <div className="react-pill" style={{ position: "relative" }}>
                  {QUICK.map((e, i) => (
                    <button
                      key={e}
                      className={`emoji-btn ${popKey?.startsWith(e) ? "pop" : ""}`}
                      onClick={() => react(e)}
                      onAnimationEnd={() => setPopKey(null)}
                      data-tip={`Atajo ${i + 1}`}
                      data-tip-pos="top"
                      aria-label={`${e}, keyboard shortcut ${i + 1}`}
                    >
                      {e}
                    </button>
                  ))}
                  <button
                    className="emoji-btn"
                    onClick={() => setMoreOpen((o) => !o)}
                    aria-label="More reactions"
                    style={{ color: "var(--grey7)" }}
                  >
                    <SmilePlus size={26} />
                  </button>
                  {moreOpen && (
                    <div className="emoji-more">
                      {MORE.map((e) => (
                        <button
                          key={e}
                          onClick={() => {
                            react(e);
                            setMoreOpen(false);
                          }}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                  <span className="react-sep" />
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 17, height: 44 }}
                    onClick={focusComment}
                  >
                    <MessageSquareText size={22} /> Comentar
                  </button>
                </div>
              </div>

              <div className="info-card">
                <h3>
                  Resumen{" "}
                  <span className="ai-chip">
                    <Sparkles size={11} /> IA
                  </span>
                </h3>
                {video.summary ? (
                  <p>{video.summary}</p>
                ) : !aiEnabled ? (
                  <p style={{ color: "var(--grey5)" }}>
                    Falta GROQ_API_KEY: agrégala en .env.local para generar el resumen con IA.
                  </p>
                ) : pending ? (
                  <>
                    <div className="skeleton" style={{ width: "92%" }} />
                    <div className="skeleton" style={{ width: "78%" }} />
                    <div className="skeleton" style={{ width: "55%" }} />
                  </>
                ) : (
                  <p style={{ color: "var(--grey5)" }}>
                    Este video no tiene resumen (no se detectó audio con voz).
                  </p>
                )}
              </div>

              {video.chapters && video.chapters.length > 0 && (
                <div className="info-card">
                  <h3>Capítulos</h3>
                  <ul className="chapters">
                    {video.chapters.map((c, i) => (
                      <li
                        key={i}
                        className={i === currentChapter ? "current" : ""}
                      >
                        <button
                          onClick={() => playerRef.current?.seek(c.start)}
                        >
                          <span className="ts">{formatTime(c.start)}</span>
                          <span>{c.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="side">
          <div className="side-tabs">
            <button
              className={`tab ${tab === "activity" ? "active" : ""}`}
              onClick={() => setTab("activity")}
            >
              Actividad
            </button>
            <button
              className={`tab ${tab === "transcript" ? "active" : ""}`}
              onClick={() => setTab("transcript")}
            >
              Transcripción
            </button>
            <span className="spacer" />
            <button
              className="icon-btn"
              onClick={() => setLayout("collapsed")}
              aria-label="Hide sidebar"
              data-tip="Ocultar panel"
            >
              <ChevronsRight size={18} />
            </button>
          </div>

          <div className="side-body">
            {tab === "activity" ? (
              <>
                {!name ? (
                  <form
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const n = nameDraft.trim();
                      if (!n) return;
                      setName(n);
                      try {
                        localStorage.setItem("drill:name", n);
                      } catch {}
                      setTimeout(() => composerRef.current?.focus(), 30);
                    }}
                  >
                    <span className="avatar avatar-sm">?</span>
                    <input
                      placeholder="¿Cómo te llamás? (para comentar)"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                    />
                    <button className="btn btn-primary btn-sm" type="submit">
                      Listo
                    </button>
                  </form>
                ) : (
                  <form className="composer" onSubmit={submitComment}>
                    <span className="avatar avatar-sm">{initials(name)}</span>
                    <input
                      ref={composerRef}
                      placeholder={`Respondé a ${video.author_name.split(" ")[0]}…`}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <span className="ts-chip">{formatTime(time)}</span>
                  </form>
                )}

                {activity.length === 0 ? (
                  <div className="side-empty">
                    <svg width="96" height="76" viewBox="0 0 96 76" aria-hidden>
                      <rect
                        x="6"
                        y="18"
                        width="78"
                        height="46"
                        rx="6"
                        fill="var(--grey3)"
                      />
                      <path d="M24 64 L24 76 L38 64Z" fill="var(--grey3)" />
                      <rect
                        x="18"
                        y="32"
                        width="54"
                        height="5"
                        rx="2.5"
                        fill="#fff"
                      />
                      <rect
                        x="18"
                        y="44"
                        width="38"
                        height="5"
                        rx="2.5"
                        fill="#fff"
                      />
                      <circle cx="78" cy="18" r="14" fill="var(--primary)" />
                      <path
                        d="M78 11v14M71 18h14"
                        stroke="#fff"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                    <h4>Sé el primero en comentar</h4>
                    <p>
                      Apretá <kbd>C</kbd> para responder a{" "}
                      {video.author_name.split(" ")[0]} o dejá un comentario
                      arriba.
                    </p>
                  </div>
                ) : (
                  <ul className="activity">
                    {activity.map((a) => (
                      <li key={a.id}>
                        <span className="avatar">
                          {a.kind === "comment"
                            ? initials(a.author_name)
                            : a.emoji}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div>
                            <span className="who">
                              {a.kind === "comment" ? a.author_name : "Alguien"}
                            </span>
                            <span className="when">
                              {timeAgo(a.created_at)}
                            </span>
                          </div>
                          <div className="txt">
                            {a.timestamp_ms != null && (
                              <button
                                className="ts-link"
                                onClick={() =>
                                  playerRef.current?.seek(
                                    a.timestamp_ms! / 1000,
                                  )
                                }
                              >
                                {formatTime(a.timestamp_ms / 1000)}
                              </button>
                            )}
                            {a.kind === "comment"
                              ? a.body
                              : `reaccionó con ${a.emoji}`}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : video.transcript && video.transcript.length > 0 ? (
              <div className="transcript" ref={transcriptRef}>
                {video.transcript.map((s, i) => (
                  <button
                    key={i}
                    className={i === currentSeg ? "current" : ""}
                    onClick={() => playerRef.current?.seek(s.start)}
                  >
                    <span className="ts">{formatTime(s.start)}</span>
                    <span className="t">{s.text}</span>
                  </button>
                ))}
              </div>
            ) : !aiEnabled ? (
              <p style={{ color: "var(--grey6)", marginTop: 0 }}>
                Falta GROQ_API_KEY: agrégala en .env.local y reinicia npm run dev para activar la transcripción con IA.
              </p>
            ) : pending ? (
              <>
                <p style={{ color: "var(--grey6)", marginTop: 0 }}>
                  Generando transcripción…
                </p>
                {Array.from({ length: 7 }, (_, i) => (
                  <div
                    key={i}
                    className="skeleton"
                    style={{ width: `${60 + ((i * 37) % 38)}%` }}
                  />
                ))}
              </>
            ) : (
              <p style={{ color: "var(--grey6)" }}>
                No hay transcripción disponible para este video.
              </p>
            )}
          </div>
        </aside>
      </div>

      {layout === "collapsed" && (
        <button
          className="icon-btn"
          style={{
            position: "fixed",
            right: 16,
            top: 72,
            background: "var(--surface)",
            boxShadow: "var(--shadow-medium)",
            zIndex: 20,
          }}
          onClick={() => setLayout("")}
          aria-label="Show sidebar"
        >
          <ChevronsRight size={18} style={{ transform: "rotate(180deg)" }} />
        </button>
      )}

      <RecordFab href={isOwner ? undefined : "/login"} />

      {toast && (
        <div className="toast" key={toast}>
          <span className="ok">
            <Check size={14} />
          </span>
          {toast}
        </div>
      )}
    </>
  );
}
