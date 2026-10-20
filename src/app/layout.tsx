import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { LanguageSelector } from "@/components/language-selector";
import { Logo } from "@/components/logo";
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
        <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
            <Link href="/" className="flex flex-col leading-tight" aria-label={t.app.name}>
              <Logo name={t.app.name} />
              <span className="mt-0.5 pl-[46px] text-xs text-muted">{shop?.name ?? t.app.tagline}</span>
            </Link>
            <Nav
              links={[
                { href: "/", label: t.nav.panel, icon: "grid" },
                { href: "/stock", label: t.nav.stock, icon: "box" },
                { href: "/ledger", label: t.nav.ledger, icon: "book" },
                { href: "/setup", label: t.nav.setup, icon: "sliders" },
              ]}
            />
            <LanguageSelector current={locale} t={t} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
