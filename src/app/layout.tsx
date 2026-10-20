import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LanguageSelector } from "@/components/language-selector";
import { Nav } from "@/components/nav";
import { getDictionary } from "@/i18n";
import { getCurrentShop } from "@/lib/shop";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tallypress",
  description: "Monthly sales, margin and cash for your WooCommerce shop",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-black/10 dark:border-white/10">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
            <div>
              <div className="text-xl font-semibold">{t.app.name}</div>
              <div className="text-xs opacity-70">{shop?.name ?? t.app.tagline}</div>
            </div>
            <Nav
              links={[
                { href: "/", label: t.nav.panel },
                { href: "/stock", label: t.nav.stock },
                { href: "/ledger", label: t.nav.ledger },
                { href: "/setup", label: t.nav.setup },
              ]}
            />
            <LanguageSelector current={locale} t={t} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
