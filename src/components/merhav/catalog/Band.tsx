"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";
import { InlineAliasForm } from "@/components/app/dictionary/InlineAliasForm";
import { seenText } from "@/components/app/dictionary/ProductRow";
import { ProductThumb } from "@/components/app/Viz";
import { Button, cx } from "@/components/ui";
import { fmtName } from "@/lib/format";
import { isTempId, type Product, type SupplierItem } from "@/lib/store";
import { ladder, type Port, type WireShape } from "./geometry";

/** One observer for the whole list: a band draws its wires only once it comes near the screen. */
const NEAR = "900px 0px";
type Sight = (near: boolean) => void;
const sights = new WeakMap<Element, Sight>();
let scout: IntersectionObserver | null = null;

function watch(node: Element, sight: Sight): () => void {
  scout ??= new IntersectionObserver((entries) => entries.forEach((e) => sights.get(e.target)?.(e.isIntersecting)), { rootMargin: NEAR });
  sights.set(node, sight);
  scout.observe(node);
  return () => {
    scout?.unobserve(node);
    sights.delete(node);
  };
}

interface WireSpec {
  id: string;
  /** Stays the same while a new name goes from its temporary id to its real one, and changes the moment it seats. */
  mark: string;
  seated: boolean;
}

interface WireLayout {
  width: number;
  height: number;
  top: number;
  shapes: WireShape[];
  fresh: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

/** Drawn from where the ports really stand, so a name that wraps or a form that opens simply moves its line. */
function Wires({ owner, wires }: { owner: RefObject<HTMLElement | null>; wires: readonly WireSpec[] }): ReactElement {
  const box = useRef<SVGSVGElement>(null);
  const known = useRef<Set<string> | null>(null);
  const [layout, setLayout] = useState<WireLayout | null>(null);

  useLayoutEffect(() => {
    const svg = box.current;
    const band = owner.current;
    if (!svg || !band) return;
    // Only a wire that really just appeared draws itself; a wire seen before simply stands.
    const seen = known.current;
    const fresh = seen ? new Set(wires.filter((w) => w.seated && !seen.has(w.mark)).map((w) => w.mark)) : NONE;
    known.current = new Set([...(seen ?? []), ...wires.map((w) => w.mark)]);
    const measure = () => {
      const frame = svg.getBoundingClientRect();
      const ys = [...band.querySelectorAll("[data-port]")].map((mark) => Math.round(mark.getBoundingClientRect().top - frame.top) + 0.5);
      const ports: Port[] = ys.map((y, i) => ({ y, seated: wires[i]?.seated ?? true }));
      const width = Math.round(frame.width);
      const top = ys[0] ?? 0;
      setLayout({ width, height: Math.round(frame.height), top, shapes: ladder(width, top, ports), fresh });
    };
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(band);
    return () => watcher.disconnect();
  }, [owner, wires]);

  return (
    <svg ref={box} className="mh-cat-wires" width={layout?.width} height={layout?.height} aria-hidden="true">
      {layout?.shapes.map((shape, i) => (
        <g key={wires[i]?.mark ?? i} data-wire={wires[i]?.id} className={layout.fresh.has(wires[i]?.mark ?? "") ? "is-fresh" : undefined}>
          <path className="mh-cat-wire" d={shape.d} />
          <path className="mh-cat-wire-lit" d={shape.d} pathLength={1} />
          <circle className="mh-cat-jack" cx={0} cy={shape.y} r={2.5} />
          {shape.loose !== null ? <circle className="mh-cat-jack is-open" cx={shape.loose + 3} cy={shape.y} r={3} /> : null}
        </g>
      ))}
      {layout && layout.shapes.some((shape) => shape.loose === null) ? <circle className="mh-cat-jack" cx={layout.width} cy={layout.top} r={2.5} /> : null}
    </svg>
  );
}

export interface BandProps {
  product: Product;
  aliases: SupplierItem[];
  supplierName: (id: string) => string;
  open: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onOpenProduct: (id: string) => void;
  onOpenName: (item: SupplierItem) => void;
  onApprove: (item: SupplierItem) => void;
  onUnapprove: (item: SupplierItem) => void;
  onRemove: (item: SupplierItem) => void;
  onSupplier: (id: string) => void;
  approvingId: string | null;
}

/** One supplier's names stay together, in the order the page sorted them, so whatever waits still comes first. */
function bySupplier(aliases: SupplierItem[]): SupplierItem[] {
  const groups = new Map<string, SupplierItem[]>();
  for (const a of aliases) {
    const group = groups.get(a.supplier_id);
    if (group) group.push(a);
    else groups.set(a.supplier_id, [a]);
  }
  return [...groups.values()].flat();
}

function BandInner({ product, aliases, supplierName, open, onOpen, onClose, onOpenProduct, onOpenName, onApprove, onUnapprove, onRemove, onSupplier, approvingId }: BandProps): ReactElement {
  const band = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [near, setNear] = useState(false);

  // When the inline form closes, focus goes back to the add button.
  useEffect(() => {
    if (wasOpen.current && !open) addRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    const node = band.current;
    if (!node) return;
    return watch(node, (on) => {
      if (on) setNear(true);
    });
  }, []);

  const ordered = useMemo(() => bySupplier(aliases), [aliases]);
  const wires = useMemo<WireSpec[]>(
    () => [...ordered.map((a) => ({ id: a.id, mark: `${a.supplier_id}:${a.external_name}:${a.status}`, seated: a.status !== "pending" })), ...(open ? [{ id: "new", mark: "new", seated: true }] : [])],
    [ordered, open],
  );

  return (
    <div ref={band} className={cx("mh-cat-band", ordered.length === 0 && !open && "is-free")} role="listitem" data-band={product.id}>
      <div className="mh-cat-band-product">
        <ProductThumb product={product} />
        <span className="mh-row-main">
          <button type="button" className="mh-cat-band-name" onClick={() => onOpenProduct(product.id)} aria-label={`פתיחת מוצר ${product.name}`} title="פתיחת מוצר">{fmtName(product.name)}</button>
          <span className="mh-cat-band-code">
            <span className="ltr">{product.sku}</span>
            {open ? null : <button ref={addRef} type="button" className="mh-cat-band-add" onClick={() => onOpen(product.id)} aria-label={`הוספת שם עבור ${product.name}`}>הוספת שם</button>}
          </span>
        </span>
      </div>

      <div className="mh-cat-band-wire">
        {near && wires.length > 0 ? <Wires owner={band} wires={wires} /> : null}
        {wires.length === 0 ? <button type="button" className="mh-cat-port" onClick={() => onOpen(product.id)} aria-label={`הוספת שם עבור ${product.name}`} title="הוספת שם"><i /></button> : null}
      </div>

      <div className="mh-cat-band-names">
        {ordered.length === 0 && !open ? <span className="mh-cat-band-none">אין שמות</span> : null}
        {ordered.map((a, i) => {
          const sup = supplierName(a.supplier_id);
          const pending = a.status === "pending";
          const saving = isTempId(a.id);
          const facts = [a.times_seen > 0 ? seenText(a.times_seen) : null, saving ? "עדיין נשמר" : null].filter((v): v is string => v !== null);
          const first = i === 0 || ordered[i - 1].supplier_id !== a.supplier_id;
          return (
            <div key={a.id} className="mh-cat-name" data-name={a.id} data-supplier={a.supplier_id}>
              <i className="mh-cat-port-mark" data-port aria-hidden="true" />
              <button type="button" className="mh-cat-name-open" onClick={() => onOpenName(a)}>
                <span className="mh-cat-name-text"><bdi>{a.external_name}</bdi></span>
                {a.external_sku || facts.length > 0 ? (
                  <span className="mh-cat-name-meta">
                    {a.external_sku ? <span className="ltr">{a.external_sku}</span> : null}
                    {a.external_sku && facts.length > 0 ? " · " : null}
                    {facts.join(" · ")}
                  </span>
                ) : null}
                <span className="sa-sr">, שיוך של {sup}</span>
              </button>
              {first ? <button type="button" className="mh-cat-name-sup" data-sup={a.supplier_id} onClick={() => onSupplier(a.supplier_id)}>{sup}</button> : <span />}
              <span className="mh-cat-name-end">
                {pending ? (
                  <>
                    <span className="mh-row-word mh-tone-warn">ממתין</span>
                    <Button variant="link" size="sm" aria-label={`אישור "${a.external_name}" של ${sup}`} isLoading={approvingId === a.id} disabled={saving} onClick={() => onApprove(a)}>אישור</Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" className="mh-cat-name-tool" aria-label={`ביטול אישור "${a.external_name}" של ${sup}`} disabled={saving} onClick={() => onUnapprove(a)}>ביטול אישור</Button>
                )}
                <Button variant="ghost" size="sm" iconOnly icon="x" aria-label={`הסרת "${a.external_name}" של ${sup}`} className="mh-cat-name-tool" disabled={saving} onClick={() => onRemove(a)} />
              </span>
            </div>
          );
        })}
        {open ? (
          <div className="mh-cat-name is-form">
            <i className="mh-cat-port-mark" data-port aria-hidden="true" />
            <InlineAliasForm product={product} onClose={onClose} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const Band = memo(BandInner);
