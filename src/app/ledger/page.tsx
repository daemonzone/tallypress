import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { formatters } from "@/components/format";
import { AlignForm } from "@/components/align-form";
import { MovementForm } from "@/components/movement-form";
import { Pager, SearchBox } from "@/components/pager";
import { DataTable, Notice, Section, Td } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { addMovement, alignBalance } from "@/lib/actions";
import { buildReport } from "@/lib/report";
import { MOVEMENT_TYPES } from "@/lib/movements";
import { toCents } from "@/lib/money";
import { getCurrentShop } from "@/lib/shop";

const PER_PAGE = 20;

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();
  if (!shop) return <Notice tone="warn">{t.setupNeeded.body}</Notice>;

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const requested = Number(typeof sp.page === "string" ? sp.page : 1) || 1;

  // Search matches the note, or the type as it is named in the current language.
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const kinds = q
    ? Object.entries(t.ledger.kinds)
        .filter(([, label]) => label.toLowerCase().includes(q.toLowerCase()))
        .map(([kind]) => kind as (typeof ledgerEntries.$inferSelect)["kind"])
    : [];
  const where = and(
    eq(ledgerEntries.shopId, shop.id),
    like ? or(ilike(ledgerEntries.note, like), kinds.length ? inArray(ledgerEntries.kind, kinds) : undefined) : undefined,
  );
  const [{ n: total }] = await db.select({ n: count() }).from(ledgerEntries).where(where);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, requested), pages);
  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(where)
    .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.id))
    .limit(PER_PAGE)
    .offset((page - 1) * PER_PAGE);
  const computedCash = (await buildReport(shop.id))?.overview.cash ?? 0;
  const fmt = formatters(locale, shop.currency);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: shop.timezone });

  return (
    <>
      <Section
        title={t.ledger.title}
        aside={<SearchBox action="/ledger" q={q} placeholder={t.ledger.searchPlaceholder} button={t.stock.searchButton} />}
      >
        {entries.length === 0 ? (
          <p className="text-sm text-muted">{q ? t.ledger.noResults : t.ledger.empty}</p>
        ) : (
          <DataTable head={[t.common.date, t.ledger.kind, t.common.amount, t.common.note]} numericFrom={2}>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="py-2 pr-3">{date.format(e.occurredAt)}</td>
                <td className="py-2 pr-3">
                  {t.ledger.kinds[e.kind]}
                  {e.estimated && (
                    <span className="ml-2 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                      {t.ledger.estimated}
                    </span>
                  )}
                </td>
                <Td className={toCents(e.amount) < 0 ? "" : "text-good"}>{fmt.money(toCents(e.amount))}</Td>
                <td className="py-2 pr-3 text-right opacity-70">{e.note ?? ""}</td>
              </tr>
            ))}
          </DataTable>
        )}
        <Pager
          basePath="/ledger"
          q={q}
          page={page}
          pages={pages}
          total={total} locale={locale}
          labels={{ ...t.stock, results: t.ledger.results }}
        />
        <p className="mt-2 text-xs text-muted">{t.ledger.salesNote}</p>
      </Section>

      <Section title={t.ledger.align.title} help={t.ledger.align.help}>
        <AlignForm action={alignBalance} locale={locale} currency={shop.currency} computed={computedCash} labels={t.ledger.align} />
      </Section>

      <Section title={t.ledger.movementTitle} help={t.ledger.movementHelp}>
        <MovementForm
          action={addMovement}
          types={MOVEMENT_TYPES.map((m) => ({
            value: m.value,
            sign: m.sign,
            needsNote: m.needsNote,
            label: t.ledger.types[m.value as keyof typeof t.ledger.types],
          }))}
          labels={t.ledger.form}
        />
      </Section>
    </>
  );
}
