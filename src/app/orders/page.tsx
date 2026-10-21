import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderCoupons, orderLines, orders } from "@/db/schema";
import { formatters } from "@/components/format";
import { ChannelIcon, OriginBadge, PaymentIcon, originOf } from "@/components/order-icons";
import { Pager, SearchBox } from "@/components/pager";
import { DataTable, Notice, Section, Td } from "@/components/ui";
import { getDictionary } from "@/i18n";
import { COUNTED_STATUSES } from "@/lib/costs";
import { toCents } from "@/lib/money";
import { getCurrentShop } from "@/lib/shop";

const PER_PAGE = 10;

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const { locale, t } = await getDictionary();
  const shop = await getCurrentShop();
  if (!shop) return <Notice tone="warn">{t.setupNeeded.body}</Notice>;

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const requested = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const o = t.orders;

  // The search looks at the order number, the products sold, coupon codes, how it was paid, where it came
  // from and its status; labels are matched in the current language too ("Completato", "App mobile"...).
  const term = q.toLowerCase();
  const codesFor = (labels: Record<string, string>) =>
    Object.entries(labels).filter(([, label]) => label.toLowerCase().includes(term)).map(([code]) => code);
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const statusCodes = q ? codesFor(o.statuses) : [];
  const paymentCodes = q ? codesFor(o.payment) : [];
  const channelCodes = q ? codesFor(o.channels) : [];
  const originCodes = q ? codesFor(o.origins) : [];

  const search = like
    ? or(
        sql`${orders.wooOrderId}::text LIKE ${like}`,
        ilike(orders.status, like),
        ilike(orders.paymentMethod, like),
        ilike(orders.paymentMethodTitle, like),
        ilike(orders.transactionId, like),
        ilike(orders.createdVia, like),
        ilike(orders.sourceType, like),
        ilike(orders.utmSource, like),
        ilike(orders.utmMedium, like),
        sql`EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = ${orders.id} AND l.name ILIKE ${like})`,
        sql`EXISTS (SELECT 1 FROM order_coupons c WHERE c.order_id = ${orders.id} AND c.code ILIKE ${like})`,
        statusCodes.length ? inArray(orders.status, statusCodes) : undefined,
        paymentCodes.length ? inArray(orders.paymentMethod, paymentCodes) : undefined,
        o.manual.toLowerCase().includes(term) ? isNull(orders.paymentMethod) : undefined,
        channelCodes.length ? inArray(orders.createdVia, channelCodes) : undefined,
        originCodes.length ? inArray(orders.sourceType, originCodes) : undefined,
      )
    : undefined;
  const where = and(eq(orders.shopId, shop.id), search);

  const [{ n: total }] = await db.select({ n: count() }).from(orders).where(where);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, requested), pages);
  const rows = await db
    .select()
    .from(orders)
    .where(where)
    .orderBy(desc(orders.placedAt), desc(orders.wooOrderId))
    .limit(PER_PAGE)
    .offset((page - 1) * PER_PAGE);

  // Products and coupons of the orders on this page.
  const ids = rows.map((r) => r.id);
  const lines = ids.length
    ? await db
        .select({ orderId: orderLines.orderId, name: orderLines.name, quantity: orderLines.quantity })
        .from(orderLines)
        .where(inArray(orderLines.orderId, ids))
    : [];
  const coupons = ids.length
    ? await db.select({ orderId: orderCoupons.orderId, code: orderCoupons.code }).from(orderCoupons).where(inArray(orderCoupons.orderId, ids))
    : [];
  const linesOf = (id: string) => lines.filter((l) => l.orderId === id);
  const couponsOf = (id: string) => coupons.filter((c) => c.orderId === id).map((c) => c.code);

  const fmt = formatters(locale, shop.currency);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: shop.timezone });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: shop.timezone });
  const statusLabel = (s: string) => (o.statuses as Record<string, string>)[s] ?? s;

  return (
    <Section
      title={o.title}
      aside={<SearchBox action="/orders" q={q} placeholder={o.searchPlaceholder} button={t.stock.searchButton} wide />}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{q ? o.noResults : o.empty}</p>
      ) : (
        <>
          <DataTable
            head={[o.columns.date, o.columns.order, o.columns.status, o.columns.products, o.columns.total, o.columns.discount, o.columns.payment, o.columns.channel, o.columns.origin]}
            align={["left", "left", "left", "left", "right", "right", "left", "left", "left"]}
            minWidth="58rem"
          >
            {rows.map((r) => {
              const counted = COUNTED_STATUSES.includes(r.status);
              const items = linesOf(r.id);
              const shown = items.slice(0, 3);
              const code = r.paymentMethod ?? "";
              const payment = code ? ((o.payment as Record<string, string>)[code] ?? r.paymentMethodTitle ?? code) : o.manual;
              // The label's own detail only when it adds something (the card brand, "Paga in 3 rate").
              const detail = r.paymentMethodTitle && !payment.toLowerCase().includes(r.paymentMethodTitle.toLowerCase()) ? r.paymentMethodTitle : null;
              const channel = r.createdVia ? ((o.channels as Record<string, string>)[r.createdVia] ?? r.createdVia) : "";
              const origin = originOf(r.sourceType, r.utmSource);
              const originDetail = [r.utmSource, r.utmMedium].filter((x) => x && x !== "(direct)").join(" / ") || null;
              const codes = couponsOf(r.id);
              const refunded = toCents(r.refundedTotal);
              return (
                <tr key={r.id} className={counted ? undefined : "text-muted"} title={counted ? undefined : o.notCounted}>
                  <td className="whitespace-nowrap py-2.5 pr-3 align-top">
                    <div>{day.format(r.placedAt)}</div>
                    <div className="text-xs text-muted tabular-nums">{time.format(r.placedAt)}</div>
                  </td>
                  <td className="py-2.5 pr-3 align-top tabular-nums">#{r.wooOrderId}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 align-top">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs ${counted ? "bg-surface-2" : ""}`}>
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${r.status === "completed" ? "bg-good" : r.status === "processing" ? "bg-accent" : "bg-muted"}`}
                      />
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 align-top text-xs leading-5">
                    {shown.map((l, i) => (
                      <div key={i} className="max-w-[17rem] truncate">
                        {Number(l.quantity) !== 1 && <span className="tabular-nums">{fmt.num(Number(l.quantity))} × </span>}
                        {l.name ?? "—"}
                      </div>
                    ))}
                    {items.length > shown.length && (
                      <div className="text-muted">{o.moreProducts.replace("{n}", String(items.length - shown.length))}</div>
                    )}
                  </td>
                  <Td className="whitespace-nowrap align-top">
                    {fmt.money(toCents(r.grossTotal))}
                    {refunded > 0 && <div className="text-xs text-muted">{o.refunded.replace("{amount}", fmt.money(refunded))}</div>}
                  </Td>
                  <Td className="whitespace-nowrap align-top">
                    {codes.length || toCents(r.discountTotal) > 0 ? (
                      <>
                        −{fmt.money(toCents(r.discountTotal))}
                        {codes.map((c) => (
                          <div key={c} className="text-xs text-muted">
                            {c}
                          </div>
                        ))}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <td className="py-2.5 pr-3 align-top">
                    <PaymentIcon code={code || null} name={payment} detail={detail} />
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    <ChannelIcon via={r.createdVia} name={channel} />
                  </td>
                  <td className="py-2.5 pr-3 align-top">
                    {origin ? <OriginBadge kind={origin} label={o.originShort[origin]} detail={originDetail} /> : <span className="text-muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        </>
      )}
      <Pager basePath="/orders" q={q} page={page} pages={pages} total={total} locale={locale} labels={{ ...t.stock, results: o.results }} />
    </Section>
  );
}
