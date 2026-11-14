import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { DARK_SCHEME, THEME_COLORS, THEME_KEY } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "fourfivex",
  description: "Say what you want, see what will happen, sign. One surface over NEAR.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: DARK_SCHEME, color: THEME_COLORS.dark },
  ],
  colorScheme: "light dark",
};

// Apply a saved override before the first paint. System mode also works with CSS alone.
const themeScript = `try {
  const theme = localStorage.getItem(${JSON.stringify(THEME_KEY)});
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
    const colors = ${JSON.stringify(THEME_COLORS)};
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = colors[theme];
  }
} catch {}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <head>
        {/* The inline script applies the stored theme before hydration and the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full select-none [&_input]:select-text [&_textarea]:select-text">{children}</body>
    </html>
  );
}
