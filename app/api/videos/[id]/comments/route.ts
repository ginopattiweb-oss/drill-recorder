import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const text = String(body.body || "").trim().slice(0, 4000);
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (!(await store.getVideo(id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const data = await store.addComment(id, {
      body: text,
      author_name: String(body.authorName || "Anonymous").slice(0, 80),
      timestamp_ms: Number.isFinite(body.timestampMs) ? Math.round(body.timestampMs) : null,
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
