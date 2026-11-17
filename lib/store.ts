// Capa de datos de Boom con dos backends intercambiables:
//  - Supabase (si hay SUPABASE_URL + SUPABASE_SERVICE_KEY): Postgres + Storage, para producción.
//  - Local (sin claves): un JSON y archivos dentro de .data/, para que todo funcione de entrada.
// Solo se usa desde el servidor (route handlers y páginas).
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  admin,
  BUCKET,
  hasSupabase,
  type BoomComment,
  type BoomReaction,
  type BoomVideo,
} from "@/lib/supabase";

export const DATA_ROOT = process.env.BOOM_DATA_DIR || path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_ROOT, "boom.json");
export const FILES_ROOT = path.join(DATA_ROOT, "files");

type LocalDb = { videos: BoomVideo[]; comments: BoomComment[]; reactions: BoomReaction[] };

// ---------- backend local ----------

let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function readDb(): Promise<LocalDb> {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, "utf8")) as LocalDb;
  } catch {
    return { videos: [], comments: [], reactions: [] };
  }
}

async function writeDb(db: LocalDb) {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db));
  await fs.rename(tmp, DB_FILE);
}

function newVideoRow(input: Partial<BoomVideo> & { id: string }): BoomVideo {
  return {
    title: "Untitled Boom",
    status: "uploading",
    mime_type: "video/webm",
    parts: 1,
    size_bytes: 0,
    duration_ms: 0,
    width: null,
    height: null,
    has_thumbnail: false,
    views: 0,
    transcript: null,
    transcript_status: "none",
    summary: null,
    chapters: null,
    author_name: process.env.NEXT_PUBLIC_BOOM_OWNER_NAME || "Boom",
    created_at: new Date().toISOString(),
    ...input,
  } as BoomVideo;
}

// Ruta segura dentro de .data/files (solo {id}/part-N.ext o {id}/thumb.jpg)
const SAFE_PATH = /^[a-z0-9]{1,40}\/(part-\d{1,3}\.(mp4|webm)|thumb\.jpg)$/;
export function localFilePath(rel: string) {
  return SAFE_PATH.test(rel) ? path.join(FILES_ROOT, rel) : null;
}

// ---------- API unificada ----------

export const store = {
  mode: () => (hasSupabase() ? ("supabase" as const) : ("local" as const)),

  async listVideos(): Promise<BoomVideo[]> {
    if (hasSupabase()) {
      const { data, error } = await admin().from("boom_videos").select("*").order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as BoomVideo[];
    }
    const db = await readDb();
    return [...db.videos].sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  async getVideo(id: string): Promise<BoomVideo | null> {
    if (hasSupabase()) {
      const { data } = await admin().from("boom_videos").select("*").eq("id", id).maybeSingle();
      return (data as BoomVideo | null) ?? null;
    }
    return (await readDb()).videos.find((v) => v.id === id) ?? null;
  },

  async getComments(id: string): Promise<BoomComment[]> {
    if (hasSupabase()) {
      const { data } = await admin().from("boom_comments").select("*").eq("video_id", id).order("created_at");
      return (data ?? []) as BoomComment[];
    }
    return (await readDb()).comments.filter((c) => c.video_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  },

  async getReactions(id: string): Promise<BoomReaction[]> {
    if (hasSupabase()) {
      const { data } = await admin().from("boom_reactions").select("*").eq("video_id", id).order("created_at");
      return (data ?? []) as BoomReaction[];
    }
    return (await readDb()).reactions.filter((r) => r.video_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  },

  async createVideo(input: Partial<BoomVideo> & { id: string }): Promise<void> {
    if (hasSupabase()) {
      const row: Record<string, unknown> = { ...input };
      const { error } = await admin().from("boom_videos").insert(row);
      if (error) throw new Error(error.message);
      return;
    }
    await locked(async () => {
      const db = await readDb();
      db.videos.push(newVideoRow(input));
      await writeDb(db);
    });
  },

  async updateVideo(id: string, patch: Partial<BoomVideo>): Promise<BoomVideo | null> {
    if (hasSupabase()) {
      const q = admin().from("boom_videos").update(patch as Record<string, unknown>).eq("id", id).select().maybeSingle();
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data as BoomVideo | null) ?? null;
    }
    return locked(async () => {
      const db = await readDb();
      const v = db.videos.find((x) => x.id === id);
      if (!v) return null;
      Object.assign(v, patch);
      await writeDb(db);
      return v;
    });
  },

  async deleteVideo(id: string): Promise<void> {
    if (hasSupabase()) {
      const sb = admin();
      const { data: files } = await sb.storage.from(BUCKET).list(id);
      if (files?.length) await sb.storage.from(BUCKET).remove(files.map((f) => `${id}/${f.name}`));
      await sb.from("boom_videos").delete().eq("id", id);
      return;
    }
    await locked(async () => {
      const db = await readDb();
      db.videos = db.videos.filter((v) => v.id !== id);
      db.comments = db.comments.filter((c) => c.video_id !== id);
      db.reactions = db.reactions.filter((r) => r.video_id !== id);
      await writeDb(db);
    });
    if (/^[a-z0-9]{1,40}$/.test(id)) await fs.rm(path.join(FILES_ROOT, id), { recursive: true, force: true });
  },

  async addComment(id: string, c: { body: string; author_name: string; timestamp_ms: number | null }): Promise<BoomComment> {
    if (hasSupabase()) {
      const { data, error } = await admin().from("boom_comments").insert({ video_id: id, ...c }).select().single();
      if (error) throw new Error(error.message);
      return data as BoomComment;
    }
    return locked(async () => {
      const db = await readDb();
      const row: BoomComment = { id: crypto.randomUUID(), video_id: id, created_at: new Date().toISOString(), ...c };
      db.comments.push(row);
      await writeDb(db);
      return row;
    });
  },

  async addReaction(id: string, r: { emoji: string; timestamp_ms: number }): Promise<BoomReaction> {
    if (hasSupabase()) {
      const { data, error } = await admin().from("boom_reactions").insert({ video_id: id, ...r }).select().single();
      if (error) throw new Error(error.message);
      return data as BoomReaction;
    }
    return locked(async () => {
      const db = await readDb();
      const row: BoomReaction = { id: crypto.randomUUID(), video_id: id, created_at: new Date().toISOString(), ...r };
      db.reactions.push(row);
      await writeDb(db);
      return row;
    });
  },

  async incrementViews(id: string): Promise<number> {
    if (hasSupabase()) {
      const { data } = await admin().rpc("boom_increment_views", { vid: id });
      return (data as number | null) ?? 0;
    }
    return locked(async () => {
      const db = await readDb();
      const v = db.videos.find((x) => x.id === id);
      if (!v) return 0;
      v.views += 1;
      await writeDb(db);
      return v.views;
    });
  },

  // URLs a las que el navegador sube cada archivo: firmadas de Supabase, o el endpoint local /api/upload.
  async createUploads(paths: string[]): Promise<{ path: string; signedUrl: string }[]> {
    if (hasSupabase()) {
      const sb = admin();
      return Promise.all(
        paths.map(async (p) => {
          const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(p, { upsert: true });
          if (error) throw new Error(error.message);
          return { path: p, signedUrl: data.signedUrl };
        }),
      );
    }
    return paths.map((p) => ({ path: p, signedUrl: `/api/upload/${p}` }));
  },
};
