import type { Metadata, Viewport } from "next";
import { Noto_Sans_Lao } from "next/font/google";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import "./globals.css";

const notoSansLao = Noto_Sans_Lao({
  variable: "--font-noto-sans-lao",
  subsets: ["lao"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  applicationName: "ODG Sale",
  title: "ODG ຂາຍ",
  description: "ລະບົບຈັດການການຂາຍ",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ODG Sale",
  },
  icons: {
    icon: [
      { url: "/odm.png", sizes: "852x606", type: "image/png" },
    ],
    apple: [
      { url: "/odm.png", sizes: "852x606", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  // Disable pinch / double-tap zoom (kiosk-style POS use).
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="lo"
      className={`${notoSansLao.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions and the LINE in-app
          browser inject attributes into <body> after SSR (e.g.
          cz-shortcut-listen), which trips React's hydration-mismatch error.
          Suppression is attribute-level and one node deep — real content
          mismatches below still surface. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <PwaRegistrar />
        {children}
      </body>
    </html>
  );
}
