import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { LanguageSelector } from "@/components/language-selector";
import { Logo } from "@/components/logo";
import { Nav } from "@/components/nav";
import { UserMenu } from "@/components/user-menu";
import { getDictionary } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { logout } from "@/lib/auth-actions";
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
  const user = await currentUser();
  // Nothing about the shop is shown to someone who is not signed in.
  const shop = user ? await getCurrentShop() : null;

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
              <span className="mt-0.5 pl-[46px] text-xs text-muted">{user ? (shop?.name ?? t.app.tagline) : t.app.tagline}</span>
            </Link>
            {user && (
              <Nav
                links={[
                  { href: "/", label: t.nav.panel, icon: "grid" },
                  { href: "/orders", label: t.nav.orders, icon: "bag" },
                  { href: "/stock", label: t.nav.stock, icon: "box" },
                  { href: "/ledger", label: t.nav.ledger, icon: "book" },
                  { href: "/setup", label: t.nav.setup, icon: "sliders" },
                ]}
              />
            )}
            <div className="flex items-center gap-3">
              <LanguageSelector current={locale} t={t} />
              {user && <UserMenu email={user.email} label={t.auth.logout} action={logout} />}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
