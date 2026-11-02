"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { available, useCatalog, type Product } from "@/lib/catalog";
import { Notice, NoticeRow } from "@/components/catalog/Notice";
import { openedFrom, ProductCard, ProductImage } from "@/components/catalog/ProductCard";
import { Reveal } from "@/components/catalog/Reveal";
import { useDrawer } from "@/components/catalog/Shell";
import { Stepper } from "@/components/catalog/Stepper";
import { fmtName, fmtPrice, fmtQty } from "@/lib/catalog/format";

const RELATED = 3;

/** Why this product can't be promised, and what an agent can do about it. Under one unit left counts here too. */
function nothingFree(p: Product): { title: string; text: string } {
  if (p.qty <= 0) return { title: "אזל מהמלאי", text: "אין מהמוצר הזה במחסן. אפשר לבדוק עם המחסן מתי תגיע סחורה" };
  if (p.reserved >= p.qty) return { title: "הכול משוריין", text: "כל הכמות במחסן שמורה להזמנות פתוחות. אפשר לבדוק עם המחסן אם משהו ישתחרר" };
  return { title: "פחות מיחידה אחת", text: `נשארו ${fmtQty(available(p))} ${p.unit} במלאי. אפשר לבדוק עם המחסן מתי תגיע סחורה` };
}

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { product } = useCatalog();
  const p = product(id);
  if (!p) {
    return (
      <main className="cg-page">
        <h1 className="cg-page__title">המוצר לא נמצא</h1>
        <p className="cg-page__sub">ייתכן שהוסר מהקטלוג</p>
        <p style={{ marginTop: 24 }}><Link href="/catalog" className="cg-link">חזרה לקטלוג</Link></p>
      </main>
    );
  }
  // Each product starts fresh: quantity and the "added" word belong to the page they were set on.
  return <Detail key={p.id} product={p} />;
}

function Detail({ product: p }: { product: Product }) {
  const { products, lines, inDraft, addToDraft } = useCatalog();
  const { show } = useDrawer();
  const router = useRouter();
  const [wanted, setWanted] = useState(1);
  /** The stop on screen: stock that doesn't cover the request, or the choice after adding. */
  const [stop, setStop] = useState<{ short: true } | { added: number } | null>(null);

  const free = available(p);
  const inOrder = inDraft(p.id);
  const room = Math.max(Math.floor(free - inOrder), 0);
  // Stock can arrive while the message is open; the offer never goes past what was asked.
  const fits = Math.min(wanted, room);

  const add = (qty: number) => {
    addToDraft(p.id, qty);
    setWanted(1);
    setStop({ added: qty });
  };

  const toOrder = () => {
    setStop(null);
    show();
  };

  const keepBrowsing = () => {
    setStop(null);
    if (openedFrom.grid) router.back();
    else router.push("/catalog");
  };

  const related = useMemo(() => {
    const others = products.filter((x) => x.id !== p.id && available(x) > 0);
    const near = others.filter((x) => x.category === p.category);
    return [...near, ...others.filter((x) => x.category !== p.category)].slice(0, RELATED);
  }, [products, p.id, p.category]);

  return (
    <main className="cg-product">
      <nav className="cg-crumbs" aria-label="מיקום באתר">
        <Link href="/catalog">קטלוג</Link>
        <span aria-hidden="true">/</span>
        {p.category ? (
          <>
            <Link href={`/catalog?c=${encodeURIComponent(p.category)}`}>{p.category}</Link>
            <span aria-hidden="true">/</span>
          </>
        ) : null}
        <span aria-current="page">{fmtName(p.name)}</span>
      </nav>

      <div className="cg-product__layout">
        <div className="cg-product__media">
          <Reveal>
            <ProductImage product={p} eager />
          </Reveal>
        </div>

        <section className="cg-product__detail">
          {p.category ? <Link href={`/catalog?c=${encodeURIComponent(p.category)}`} className="cg-product__cat">{p.category}</Link> : null}
          <h1 className="cg-product__name">{fmtName(p.name)}</h1>
          {p.price !== null ? (
            <p className="cg-product__price"><span className="cg-num">{fmtPrice(p.price)}</span> <small>ל{p.unit}</small></p>
          ) : null}

          <div className="cg-avail">
            <span className="cg-avail__label">זמין עכשיו</span>
            {free > 0 ? (
              <span className="cg-avail__value"><span className="cg-num">{fmtQty(free)}</span> <small>{p.unit}</small></span>
            ) : (
              <span className="cg-avail__value">לא זמין</span>
            )}
          </div>

          {p.description ? <p className="cg-product__desc">{p.description}</p> : null}

          {/* Nothing free means nothing to choose: no quantity, no dead button to tap at a customer's side. The reason stands in their place. */}
          {free > 0 ? (
            <div className="cg-buy">
              <Stepper label={`כמות של ${p.name}`} value={wanted} onChange={setWanted} />
              <button type="button" className="cg-btn" onClick={() => (wanted > room ? setStop({ short: true }) : add(wanted))}>
                הוספה להזמנה
              </button>
            </div>
          ) : (
            <p className="cg-why"><b>{nothingFree(p).title}</b> {nothingFree(p).text}</p>
          )}
          {inOrder > 0 ? (
            <p className="cg-inorder">
              בהזמנה <span className="cg-num">{fmtQty(inOrder)}</span> {p.unit} · <button type="button" className="cg-link" onClick={show}>צפייה בהזמנה</button>
            </p>
          ) : null}

          <dl className="cg-spec">
            <dt>מק״ט</dt>
            <dd className="cg-num" style={{ textAlign: "right" }}>{p.sku}</dd>
            {p.barcode ? (
              <>
                <dt>ברקוד</dt>
                <dd className="cg-num" style={{ textAlign: "right" }}>{p.barcode}</dd>
              </>
            ) : null}
            <dt>יחידה</dt>
            <dd>{p.unit}</dd>
          </dl>
        </section>
      </div>

      {related.length > 0 ? (
        <section className="cg-related" aria-label="עוד מוצרים">
          <h2 className="cg-related__title">{p.category && related.some((r) => r.category === p.category) ? `עוד מ${p.category}` : "עוד מהקטלוג"}</h2>
          <div className="cg-grid">
            {related.map((r, i) => (
              <Reveal key={r.id} i={i}>
                <ProductCard product={r} />
              </Reveal>
            ))}
          </div>
        </section>
      ) : null}

      {stop && "added" in stop ? (
        <Notice
          title="נוסף להזמנה"
          primary={{ label: "שליחת ההזמנה", onClick: toOrder }}
          secondary={{ label: "המשך בקטלוג", onClick: keepBrowsing }}
          onClose={() => setStop(null)}
        >
          <div className="cg-notice__item">
            <ProductImage product={p} />
            <p>
              <span className="cg-notice__name">{fmtName(p.name)}</span>
              <span className="cg-notice__sub"><span className="cg-num">{fmtQty(stop.added)}</span> {p.unit}</span>
            </p>
          </div>
          <p className="cg-notice__text">{lines.length === 1 ? "מוצר אחד בהזמנה" : `${fmtQty(lines.length)} מוצרים בהזמנה`}</p>
        </Notice>
      ) : null}

      {stop && "short" in stop ? (
        room >= 1 ? (
          <Notice
            title="אין מספיק במלאי"
            primary={{ label: `הוספת ${fmtQty(fits)} ${p.unit}`, onClick: () => add(fits) }}
            secondary={{ label: "שינוי הכמות", onClick: () => setStop(null) }}
            onClose={() => setStop(null)}
          >
            <dl className="cg-notice__rows">
              <NoticeRow label="ביקשת"><span className="cg-num">{fmtQty(wanted)}</span> {p.unit}</NoticeRow>
              {inOrder > 0 ? <NoticeRow label="כבר בהזמנה"><span className="cg-num">{fmtQty(inOrder)}</span> {p.unit}</NoticeRow> : null}
              <NoticeRow label={inOrder > 0 ? "אפשר להוסיף" : "זמין עכשיו"}><span className="cg-num">{fmtQty(room)}</span> {p.unit}</NoticeRow>
            </dl>
            <p className="cg-notice__text">אפשר להזמין את מה שזמין, ועל היתר לבדוק עם המחסן</p>
          </Notice>
        ) : inOrder > 0 ? (
          <Notice
            title="הכול כבר בהזמנה"
            primary={{ label: "צפייה בהזמנה", onClick: toOrder }}
            secondary={{ label: "חזרה", onClick: () => setStop(null) }}
            onClose={() => setStop(null)}
          >
            <p className="cg-notice__text">
              כל הכמות הזמינה, <span className="cg-num">{fmtQty(inOrder)}</span> {p.unit}, כבר בהזמנה. על עוד צריך לבדוק עם המחסן
            </p>
          </Notice>
        ) : (
          <Notice title={nothingFree(p).title} primary={{ label: "הבנתי", onClick: () => setStop(null) }} onClose={() => setStop(null)}>
            <p className="cg-notice__text">{nothingFree(p).text}</p>
          </Notice>
        )
      ) : null}
    </main>
  );
}
