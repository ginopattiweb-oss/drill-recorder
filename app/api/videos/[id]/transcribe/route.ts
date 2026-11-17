import { NextResponse } from "next/server";
import { type Chapter, type TranscriptSegment } from "@/lib/supabase";
import { store } from "@/lib/store";

export const maxDuration = 300;

const GROQ = "https://api.groq.com/openai/v1";

// Recibe el audio (grabado aparte, liviano) y genera transcripción + título/resumen/capítulos estilo Loom AI.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    // Sin clave de Groq la app funciona igual; solo se desactivan transcripción, resumen y capítulos.
    await store.updateVideo(id, { transcript_status: "error" });
    return NextResponse.json(
      { error: "Falta GROQ_API_KEY: agrégala en .env.local y reinicia npm run dev para activar la transcripción con IA." },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "no audio" }, { status: 400 });
  }
  await store.updateVideo(id, { transcript_status: "processing" });

  try {
    const fd = new FormData();
    const ext = audio.type.includes("mp4") ? "m4a" : "webm";
    fd.append("file", audio, `audio.${ext}`);
    fd.append("model", "whisper-large-v3-turbo");
    fd.append("response_format", "verbose_json");
    const tr = await fetch(`${GROQ}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });
    if (!tr.ok) throw new Error(`whisper ${tr.status}: ${await tr.text()}`);
    const json = (await tr.json()) as { text: string; segments?: { start: number; end: number; text: string }[] };
    const segments: TranscriptSegment[] = (json.segments ?? [])
      .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
      .filter((s) => s.text && !/^(gracias\.?|thank you\.?|subtítulos.*)$/i.test(s.text));

    const update: Record<string, unknown> = { transcript: segments, transcript_status: "done" };

    const fullText = segments.map((s) => `[${Math.floor(s.start)}s] ${s.text}`).join("\n");
    if (fullText.length > 60) {
      const ai = await fetch(`${GROQ}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'You write metadata for a screen-recording video, in the SAME language as the transcript. Return JSON: {"title": string (max 60 chars, specific, no quotes), "summary": string (2-4 sentences, first person as the speaker), "chapters": [{"start": number (seconds), "title": string (max 6 words)}]}. Chapters: 1 per ~45-90s of content, first chapter starts at 0, max 8. If the video is under 40 seconds return an empty chapters array.',
            },
            { role: "user", content: fullText.slice(0, 24000) },
          ],
        }),
      });
      if (ai.ok) {
        const out = await ai.json();
        try {
          const meta = JSON.parse(out.choices[0].message.content) as {
            title?: string;
            summary?: string;
            chapters?: Chapter[];
          };
          if (meta.summary) update.summary = meta.summary;
          if (Array.isArray(meta.chapters)) {
            update.chapters = meta.chapters
              .filter((c) => Number.isFinite(c.start) && c.title)
              .sort((a, b) => a.start - b.start);
          }
          const current = await store.getVideo(id);
          if (meta.title && ["Grabación · ", "Boom · "].some((prefix) => current?.title?.startsWith(prefix))) update.title = meta.title;
        } catch {
          // metadata IA es opcional
        }
      }
    }

    await store.updateVideo(id, update);
    return NextResponse.json({ ok: true, segments: segments.length });
  } catch (e) {
    await store.updateVideo(id, { transcript_status: "error" });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
