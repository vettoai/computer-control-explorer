import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { getDatasetInfo } from "@/lib/dataset/loader";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const info = await getDatasetInfo();
  return {
    title: info
      ? `${info.name} · Computer Control Dataset Explorer`
      : "Computer Control Dataset Explorer",
    description:
      info?.description ?? "Browse computer-control tasks: files, trajectories, and results.",
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
