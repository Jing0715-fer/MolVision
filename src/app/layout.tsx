import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/i18n";
import { LOCALE_COOKIE, type Locale } from "@/i18n/locales";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** 服务端语言检测：cookie（用户显式选择）> Accept-Language（首次访问自动适配） */
async function detectLocale(): Promise<Locale> {
  const jar = await cookies();
  const stored = jar.get(LOCALE_COOKIE)?.value;
  if (stored === "en" || stored === "zh") return stored;
  const accept = (await headers()).get("accept-language")?.toLowerCase() ?? "";
  return accept.startsWith("en") ? "en" : "zh";
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await detectLocale();
  if (locale === "en") {
    return {
      title: "MolVision — 3D Molecular Visualization Workbench",
      description:
        "Professional PDB structure visualization built on Three.js: cartoon ribbons, ball-and-stick models, molecular surfaces, PyMOL-style selection syntax & command line, measurements, and annotations.",
      keywords: [
        "PDB",
        "molecular visualization",
        "Three.js",
        "protein structure",
        "ChimeraX",
        "PyMOL",
        "cartoon",
        "molecular surface",
      ],
      authors: [{ name: "MolVision" }],
    };
  }
  return {
    title: "MolVision — 3D 分子可视化工作台",
    description:
      "基于 Three.js 的专业级 PDB 结构可视化工具：Cartoon 带状图、球棍模型、分子表面、PyMOL 风格选择语法与命令行、测量与标注。",
    keywords: ["PDB", "分子可视化", "Three.js", "蛋白结构", "ChimeraX", "PyMOL", "cartoon", "分子表面"],
    authors: [{ name: "MolVision" }],
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#101215" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await detectLocale();
  return (
    <html lang={locale === "en" ? "en" : "zh-CN"} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <I18nProvider initialLocale={locale}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
          >
            {children}
            <Toaster position="top-right" richColors closeButton />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
