import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl =
  process.env.PROOFLATCH_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "ProofLatch — Evidence before release",
  description:
    "A deterministic release gate for agent-written code, with GPT-5.6 explanations and Codex-ready repair briefs.",
  applicationName: "ProofLatch",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/favicon.svg",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "ProofLatch — Evidence before release",
    description:
      "Rules decide. GPT-5.6 explains. Codex repairs. New evidence reopens the latch.",
    siteName: "ProofLatch",
    type: "website",
    url: "/",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "ProofLatch — the release latch for agent-written code.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ProofLatch — Evidence before release",
    description:
      "A deterministic release gate for agent-written code.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
