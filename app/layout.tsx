import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Ping — Private chat",
  description: "A private one-to-one realtime chat app.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Ping", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Resize the layout viewport when the on-screen keyboard opens so the
  // composer moves up natively and smoothly (supported in Chrome/Android 108+).
  interactiveWidget: "resizes-content",
  themeColor: "#12a378",
};

const themeScript = `(function(){try{var t=localStorage.getItem("ping-theme");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
