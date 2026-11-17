import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { RecorderProvider } from "@/components/Recorder";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3030"),
  title: "DRILL Recorder — Grabá tu pantalla y compartí al instante",
  description: "Grabá pantalla y cámara, y compartí un link al toque.",
  icons: { icon: { url: "/drill-favicon.svg", type: "image/svg+xml" } },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={figtree.variable}>
        <RecorderProvider>{children}</RecorderProvider>
      </body>
    </html>
  );
}
