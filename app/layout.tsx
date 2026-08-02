import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import MobileTabBar from "@/components/MobileTabBar";

const display = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT"],
  variable: "--font-display",
  display: "swap",
});

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Resuitme — Tailor your resume to any job",
  description:
    "Paste your LaTeX resume and a job description. Get a rating, a tailored rewrite, and a download-ready .tex file.",
  applicationName: "Resuitme",
  manifest: "/manifest.webmanifest",
  // Drives the iOS "Add to Home Screen" experience: standalone chrome, the
  // home-screen label, and a status bar that blends into the ink background.
  appleWebApp: {
    capable: true,
    title: "Resuitme",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    // Stops iOS from auto-linking phone numbers/dates inside pasted résumés.
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale/userScalable lock — pinch-zoom stays available. Input zoom
  // is prevented by using >=16px form text (see globals.css) instead.
  viewportFit: "cover",
  themeColor: "#100e0c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <head>
        {/* Next's metadata API emits only the standardized
            `mobile-web-app-capable`. iOS Safari still keys its standalone
            (Add to Home Screen) launch off the apple-prefixed tag on the
            versions most people are running, so declare it explicitly. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="antialiased font-sans">
        {children}
        <MobileTabBar />
      </body>
    </html>
  );
}
