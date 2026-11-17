import { NextResponse } from "next/server";
import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { localFilePath } from "@/lib/store";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", jpg: "image/jpeg" };

// Sirve los videos y miniaturas guardados en .data/ (modo local) con soporte de Range,
// necesario para poder adelantar/retroceder en el player.
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const rel = (await params).path.join("/");
  const file = localFilePath(rel);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  let size: number;
  try {
    size = (await fs.stat(file)).size;
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": TYPES[rel.split(".").pop()!] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  const dl = new URL(req.url).searchParams.get("download");
  if (dl) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(dl)}`;

  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), size - 1);
    } else {
      start = Math.max(0, size - Number(m[2]));
    }
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
  return new Response(body, { status, headers });
}
