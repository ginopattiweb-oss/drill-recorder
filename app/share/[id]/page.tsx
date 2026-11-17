import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { isOwnerToken, OWNER_COOKIE } from "@/lib/auth";
import { ShareView } from "@/components/ShareView";
import { extFor, thumbUrl, videoUrls } from "@/lib/supabase";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  const [video, comments, reactions] = await Promise.all([store.getVideo(id), store.getComments(id), store.getReactions(id)]);
  return { video, comments, reactions };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const v = await store.getVideo(id);
  if (!v) return { title: "DRILL Recorder" };
  const thumb = thumbUrl(v);
  return {
    title: `${v.title} | DRILL Recorder`,
    description: v.summary ?? `Un video de ${v.author_name}`,
    openGraph: {
      title: v.title,
      description: v.summary ?? `Un video de ${v.author_name} grabado con DRILL Recorder`,
      type: "video.other",
      images: thumb ? [{ url: thumb }] : undefined,
      videos: v.parts === 1 ? [{ url: videoUrls(v)[0], type: v.mime_type }] : undefined,
    },
    twitter: { card: "summary_large_image", images: thumb ? [thumb] : undefined },
  };
}

export default async function SharePage({ params }: Props) {
  const { id } = await params;
  const { video, comments, reactions } = await load(id);
  if (!video) notFound();
  const isOwner = await isOwnerToken((await cookies()).get(OWNER_COOKIE)?.value);
  const urls = videoUrls(video);
  const safeTitle = video.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 80) || "boom";
  const downloadUrl = video.parts === 1 ? `${urls[0]}?download=${encodeURIComponent(`${safeTitle}.${extFor(video.mime_type)}`)}` : null;
  return (
    <ShareView
      video={video}
      comments={comments}
      reactions={reactions}
      urls={urls}
      poster={thumbUrl(video)}
      downloadUrl={downloadUrl}
      isOwner={isOwner}
      aiEnabled={Boolean(process.env.GROQ_API_KEY)}
    />
  );
}
