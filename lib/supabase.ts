import { createClient } from "@supabase/supabase-js";

import { INSTALLATION_NAMESPACE } from "@/lib/deployment";

export const BUCKET = `${INSTALLATION_NAMESPACE}-videos`;
export const PART_SIZE = 45 * 1024 * 1024; // límite por archivo del plan free de Supabase = 50MB

export type TranscriptSegment = { start: number; end: number; text: string };
export type Chapter = { start: number; title: string };

export type RecorderVideo = {
  id: string;
  title: string;
  status: "uploading" | "ready" | "error";
  mime_type: string;
  parts: number;
  size_bytes: number;
  duration_ms: number;
  width: number | null;
  height: number | null;
  has_thumbnail: boolean;
  views: number;
  transcript: TranscriptSegment[] | null;
  transcript_status: "none" | "processing" | "done" | "error";
  summary: string | null;
  chapters: Chapter[] | null;
  author_name: string;
  created_at: string;
};

export type RecorderComment = {
  id: string;
  video_id: string;
  author_name: string;
  body: string;
  timestamp_ms: number | null;
  created_at: string;
};

export type RecorderReaction = {
  id: string;
  video_id: string;
  emoji: string;
  timestamp_ms: number;
  created_at: string;
};

// Modo de almacenamiento: con SUPABASE_URL + SUPABASE_SERVICE_KEY usa Supabase (producción);
// sin ellas guarda todo en la carpeta .data/ de tu computadora (funciona de entrada, sin cuentas).
export function hasSupabase() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

export function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false },
  });
}

export function extFor(mime: string) {
  return mime.includes("mp4") ? "mp4" : "webm";
}

export function partPath(id: string, i: number, mime: string) {
  return `${id}/part-${i}.${extFor(mime)}`;
}

export function publicUrl(path: string) {
  return hasSupabase()
    ? `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
    : `/api/files/${path}`;
}

export function videoUrls(v: Pick<RecorderVideo, "id" | "parts" | "mime_type">) {
  return Array.from({ length: v.parts }, (_, i) => publicUrl(partPath(v.id, i, v.mime_type)));
}

export function thumbUrl(v: Pick<RecorderVideo, "id" | "has_thumbnail">) {
  return v.has_thumbnail ? publicUrl(`${v.id}/thumb.jpg`) : null;
}
