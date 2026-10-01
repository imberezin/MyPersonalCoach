import type { Metadata, Viewport } from "next";
import { Rubik } from "next/font/google";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { localeDirection } from "@/i18n/config";
import { getLocale, getMessages, getTranslations } from "@/i18n/server";
import "./globals.css";

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
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#15171a" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <html lang={locale} dir={localeDirection[locale]} className={rubik.variable}>
      <body>
        <IntlClientProvider locale={locale} messages={messages}>
          {children}
        </IntlClientProvider>
      </body>
    </html>
  );
}
