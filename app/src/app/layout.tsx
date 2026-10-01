import type { Metadata, Viewport } from "next";
import { Rubik } from "next/font/google";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { localeDirection } from "@/i18n/config";
import { getLocale, getMessages, getTranslations } from "@/i18n/server";
import { THEME_COLOR } from "@/styles/brandColors";
import "./globals.css";

// Provisional font (rounded, Hebrew and Latin). The Brand document asks to check the options in
// practice before a final choice; see TODO.md. The family is consumed through --font-family.
const rubik = Rubik({
  variable: "--font-sans",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: t("name"),
    description: t("tagline"),
    appleWebApp: { capable: true, title: t("shortName"), statusBarStyle: "default" },
    icons: {
      icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      apple: "/icons/apple-touch-icon.png",
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLOR,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <html lang={locale} dir={localeDirection[locale]} className={rubik.variable}>
      {/* Browser extensions (for example Grammarly) add attributes to <body> before React
          hydrates. suppressHydrationWarning silences only that one-level attribute mismatch. */}
      <body suppressHydrationWarning>
        <IntlClientProvider locale={locale} messages={messages}>
          {children}
        </IntlClientProvider>
      </body>
    </html>
  );
}
