import type { Metadata, Viewport } from "next";
import { Cinzel, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Brand display face — inscriptional, monumental; echoes the carved
// Eye of Horus strokes in the logo. Used for wordmarks and view titles.
const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WEDJAT DOMAIN AI",
  description:
    "WEDJAT DOMAIN AI — proprietary domain intelligence platform. Grounded RAG chat over versioned platform blueprints, analysis workflows, controlled training lifecycle and full observability.",
  // Favicon is the WEDJAT brand mark (src/app/icon.png, file-based route).
};

export const viewport: Viewport = {
  // Mobile browser chrome harmonized with the night-eye canvas.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070a11" },
    { media: "(prefers-color-scheme: light)", color: "#f2f8fb" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} font-sans antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="top-right" closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
