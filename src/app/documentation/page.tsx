"use client";

/**
 * תיעוד — the factory's record in one place: receipts photographed on the floor
 * (goods in from suppliers, goods out to customers) and fault reports. A record can
 * be corrected or deleted from its panel; faults are handled on their own page.
 */
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { normalizeName, useData, type DocumentRecord, type Fault, type Movement } from "@/lib/store";
import { useUi } from "@/components/app/ui-state";
import { FormPanel } from "@/components/app/forms/FormPanel";
import { productOptions, supplierOptions } from "@/components/app/forms/options";
import { REQUIRED, useForm } from "@/components/app/forms/useForm";
import { Badge, Button, Card, Count, EmptyState, Fields, Icon, Input, Modal, PageHead, Select, Showing, SidePanel, Tabs, Toolbar, type FieldItem, type IconName, type SelectOption } from "@/components/ui";
import { ProductThumb } from "@/components/app/Viz";
import { fmtFull, fmtQty, fmtRelative, fmtUnit, orderRef } from "@/lib/format";
import { faultPhotoUrl } from "@/lib/fault-photos";
import { documentDownloadUrl, useDocumentUrls } from "@/lib/documents";

type Kind = "in" | "out" | "fault";
type Tab = "all" | Kind;

/** One card in the gallery: a receipt (`doc`) or a fault report (`fault`). */
type Entry = {
  key: string;
  kind: Kind;
  at: string;
  title: string;
  workerId: string | null;
  doc?: DocumentRecord;
  fault?: Fault;
};

const KIND_LABEL: Record<Kind, string> = { in: "קבלת הכנסה", out: "קבלת הוצאה", fault: "תקלה" };
const KIND_ICON: Record<Kind, IconName> = { in: "arrow-down-left", out: "arrow-up-right", fault: "tool" };
const REQUEST_STATUS = {
  pending: { label: "ממתין", tone: "warning" },
  approved: { label: "אושר", tone: "success" },
  rejected: { label: "נדחה", tone: "danger" },
} as const;
const PAGE_SIZE = 48;

function tabFromParams(params: URLSearchParams): Tab {
  const t = params.get("tab");
  return t === "in" || t === "out" || t === "fault" ? t : "all";
}

/** The date under a card, its time left to the panel: "לפני שעתיים", "אתמול", "28.10". */
function shortDate(iso: string): string {
  return fmtRelative(iso).split(/, | · /)[0];
}

function downloadName(entry: Entry, path: string): string {
  const d = new Date(entry.at);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const ext = path.split(".").pop() ?? "jpg";
  return `${KIND_LABEL[entry.kind]} ${entry.title} ${day}.${ext}`;
}

export default function DocumentationPage() {
  return (
    <Suspense fallback={null}>
      <DocumentationInner />
    </Suspense>
  );
}

function DocumentationInner() {
  const { state, product, supplier, worker } = useData();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab = tabFromParams(params);
  const setTab = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "all") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [query, setQuery] = useState("");
  const [workerId, setWorkerId] = useState("");

  const entries = useMemo<Entry[]>(() => {
    const docs: Entry[] = state.documents.map((d) => ({
      key: `doc:${d.id}`,
      kind: d.kind,
      at: d.created_at,
      workerId: d.worker_id,
      doc: d,
      title: d.kind === "in" ? supplier(d.supplier_id)?.name ?? "ספק שנמחק" : d.customer ?? "לקוח לא צוין",
    }));
    const faults: Entry[] = state.faults.map((f) => ({
      key: `fault:${f.id}`,
      kind: "fault",
      at: f.created_at,
      workerId: f.reported_by,
      fault: f,
      title: f.description,
    }));
    return [...docs, ...faults].sort((a, b) => b.at.localeCompare(a.at));
  }, [state.documents, state.faults, supplier]);

  const counts = useMemo(() => {
    const out: Record<Kind, number> = { in: 0, out: 0, fault: 0 };
    for (const e of entries) out[e.kind]++;
    return out;
  }, [entries]);

  const workerOptions = useMemo<SelectOption[]>(() => {
    const ids = new Set(entries.map((e) => e.workerId).filter((id): id is string => Boolean(id)));
    return state.workers.filter((w) => ids.has(w.id)).map((w) => ({ value: w.id, label: w.name }));
  }, [entries, state.workers]);

  const q = normalizeName(query);
  const visible = useMemo(
    () =>
      entries.filter((e) => {
        if (tab !== "all" && e.kind !== tab) return false;
        if (workerId && e.workerId !== workerId) return false;
        if (!q) return true;
        const p = product(e.fault?.product_id);
        const hay = normalizeName([e.title, e.doc?.reference, worker(e.workerId)?.name, p?.name, p?.sku].filter(Boolean).join(" "));
        return hay.includes(q);
      }),
    [entries, tab, workerId, q, product, worker],
  );

  const tabs = [
    { value: "all", label: "הכל" },
    { value: "in", label: "קבלות הכנסה", count: counts.in },
    { value: "out", label: "קבלות הוצאה", count: counts.out },
    { value: "fault", label: "תקלות", count: counts.fault },
  ];

  let body: ReactNode;
  if (visible.length > 0) {
    body = <Gallery key={`${tab}|${q}|${workerId}`} entries={visible} showKind={tab === "all"} />;
  } else if (q || workerId) {
    body = (
      <EmptyState title="לא נמצא תיעוד" hint={q && !workerId ? <>עבור „<bdi>{query.trim()}</bdi>”</> : "אפשר להסיר את הסינון"}>
        <Button variant="secondary" onClick={() => { setQuery(""); setWorkerId(""); }}>ניקוי סינון</Button>
      </EmptyState>
    );
  } else if (tab === "in") {
    body = <EmptyState title="אין קבלות הכנסה" hint="קבלה שעובד מצלם בקליטה תופיע כאן" />;
  } else if (tab === "out") {
    body = <EmptyState title="אין קבלות הוצאה" hint="קבלה שעובד מצלם בהוצאה תופיע כאן" />;
  } else if (tab === "fault") {
    body = <EmptyState title="אין תקלות" hint="דיווח תקלה מהטלפון יופיע כאן" />;
  } else {
    body = <EmptyState title="אין תיעוד" hint="קבלות מהטלפון ודיווחי תקלות יופיעו כאן" />;
  }

  return (
    <div className="sa-page">
      <PageHead title="תיעוד" sub={<Count n={entries.length} one="רשומה" many="רשומות" />} />

      <Toolbar
        tabs={<Tabs tabs={tabs} value={tab} onChange={setTab} />}
        filters={workerOptions.length > 0 ? <Select options={workerOptions} value={workerId} onChange={setWorkerId} allLabel="כל העובדים" placeholder="עובד" /> : null}
        query={query}
        onQuery={setQuery}
        placeholder="חיפוש לפי שם או עובד"
      />

      {visible.length > 0 ? body : <Card flush>{body}</Card>}
    </div>
  );
}

function Gallery({ entries, showKind }: { entries: Entry[]; showKind: boolean }) {
  const { product } = useData();
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const page = entries.slice(0, shown);
  const urls = useDocumentUrls(page.flatMap((e) => (e.doc ? [e.doc.storage_path] : [])));
  const photo = (e: Entry): string | null => (e.doc ? urls[e.doc.storage_path] ?? null : faultPhotoUrl(e.fault?.photo_path));
  const open = page.find((e) => e.key === openKey);

  return (
    <Card
      flush
      className="sa-doc-desk"
      footer={
        page.length < entries.length ? (
          <>
            <Showing shown={page.length} total={entries.length} />
            <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>הצגת עוד</Button>
          </>
        ) : undefined
      }
    >
      <ul className="sa-doc-grid" aria-label="תיעוד">
        {page.map((e) => {
          const src = photo(e);
          // With no photo the report's own words are the picture, and the product takes their place under it.
          const note = e.fault && !src ? e.title : null;
          const item = product(e.fault?.product_id);
          const heading = note ? item?.name ?? KIND_LABEL[e.kind] : e.title;
          return (
            <li key={e.key}>
              <button type="button" className="sa-doc-card" onClick={() => setOpenKey(e.key)}>
                <span className={note ? "sa-doc-thumb is-empty" : "sa-doc-thumb"}>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" loading="lazy" decoding="async" />
                  ) : note ? (
                    <>
                      {item?.image_path ? <ProductThumb product={item} /> : null}
                      <span className="sa-doc-note">{note}</span>
                    </>
                  ) : null}
                </span>
                <span className="sa-doc-caption">
                  <span className="sa-doc-title">{heading}</span>
                  <span className="sa-doc-meta">
                    {showKind && heading !== KIND_LABEL[e.kind] ? (
                      <>
                        <Icon name={KIND_ICON[e.kind]} size={15} />
                        <span className="sa-truncate">{KIND_LABEL[e.kind]}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    ) : null}
                    <span className="sa-doc-date">{shortDate(e.at)}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open ? <EntryPanel key={open.key} entry={open} src={photo(open)} onClose={() => setOpenKey(null)} /> : null}
    </Card>
  );
}

/** Details of one gallery card, in the same side panel the rest of the app uses. */
function EntryPanel({ entry, src, onClose }: { entry: Entry; src: string | null; onClose: () => void }) {
  const { state, product, worker, fetchDocumentMovements, deleteDocument, deleteFault } = useData();
  const { notify } = useUi();
  const router = useRouter();
  const { doc, fault } = entry;
  const docId = doc?.id;

  const [moved, setMoved] = useState<Movement[] | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!docId) return;
    fetchDocumentMovements(docId).then(setMoved, () => setMoved([]));
  }, [docId, fetchDocumentMovements]);

  // The receipt behind goods that left stays: without it the exit would be undocumented.
  const kept = doc?.kind === "out" && (moved === null || moved.some((m) => m.type === "out"));

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  const download = async () => {
    if (!doc) return;
    setDownloading(true);
    try {
      window.location.assign(await documentDownloadUrl(doc.storage_path, downloadName(entry, doc.storage_path)));
    } catch (e) {
      notify({ tone: "danger", title: "הורדת התמונה נכשלה", text: e instanceof Error ? e.message : undefined });
    } finally {
      setDownloading(false);
    }
  };

  const remove = async () => {
    // The dialog leaves first: unmounted together with this panel, it would put back the scroll lock.
    setConfirmDelete(false);
    setDeleting(true);
    try {
      if (doc) await deleteDocument(doc);
      else if (fault) await deleteFault(fault);
      notify({ tone: "success", title: `${KIND_LABEL[entry.kind]} נמחקה` });
    } catch (e) {
      setDeleting(false);
      notify({ tone: "danger", title: "המחיקה נכשלה", text: e instanceof Error ? e.message : undefined });
    }
  };

  const reporter = worker(entry.workerId)?.name;
  const faultProduct = product(fault?.product_id);
  const order = orderRef(doc?.reference);
  const fields: FieldItem[] = doc
    ? [
        { label: doc.kind === "in" ? "ספק" : "לקוח", value: entry.title },
        { label: "עובד", value: reporter },
        ...(order ? [{ label: "מקור", value: order }] : []),
      ]
    : [
        { label: "מוצר", value: faultProduct?.name ?? (fault?.product_id ? "מוצר שנמחק" : "ללא מוצר") },
        { label: "דווח ע\"י", value: reporter },
        { label: "מצב", value: fault?.status === "resolved" ? <Badge tone="success" dot={false}>טופלה</Badge> : <Badge tone="warning" dot={false}>פתוחה</Badge> },
        ...(fault?.resolved_at ? [{ label: "טופלה בתאריך", value: fmtFull(fault.resolved_at) }] : []),
      ];

  const requests = docId ? state.itemRequests.filter((r) => r.document_id === docId) : [];
  const lines = [
    ...(moved ?? []).map((m) => {
      const p = product(m.product_id);
      return { key: m.id, product: p, name: p?.name ?? m.external_name ?? "מוצר שנמחק", qty: m.qty, unit: p?.unit, status: undefined as (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS] | undefined };
    }),
    ...requests.map((r) => ({ key: r.id, product: undefined, name: r.proposed_name?.trim() || r.external_name, qty: r.qty, unit: undefined, status: REQUEST_STATUS[r.status] })),
  ];

  const photo = src ? (
    <a className="sa-doc-photo" href={src} target="_blank" rel="noreferrer" aria-label="פתיחת התמונה בגודל מלא">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${KIND_LABEL[entry.kind]}: ${entry.title}`} />
    </a>
  ) : doc ? (
    <span className="sa-skeleton sa-doc-photo-wait" aria-label="טוען תמונה" />
  ) : null;

  return createPortal(
    <>
      <div className="sa-scrim app-scrim" onClick={onClose} aria-hidden />
      <div className="app-panelHost" role="dialog" aria-modal="true">
        {editing ? (
          <EntryForm entry={entry} onClose={() => setEditing(false)}>{photo}</EntryForm>
        ) : (
          <SidePanel
            className="sa-sheet sa-doc-sheet"
            media={photo}
            eyebrow={KIND_LABEL[entry.kind]}
            title={entry.title}
            subtitle={fmtFull(entry.at)}
            onClose={onClose}
            footer={
              <>
                <div>
                  {kept ? null : <Button variant="danger" isLoading={deleting} onClick={() => setConfirmDelete(true)}>מחיקה</Button>}
                </div>
                <div>
                  <Button variant="secondary" disabled={deleting} onClick={() => setEditing(true)}>עריכה</Button>
                  {doc ? (
                    <Button variant="secondary" icon="download" isLoading={downloading} onClick={() => void download()}>הורדת תמונה</Button>
                  ) : (
                    <Button variant="secondary" onClick={() => router.push(fault?.status === "resolved" ? "/faults?tab=resolved" : "/faults")}>מעבר לתקלות</Button>
                  )}
                </div>
              </>
            }
          >
            <Fields items={fields} />

            {docId && moved === null ? (
              <span className="sa-skeleton" style={{ width: 200 }} />
            ) : lines.length > 0 ? (
              <section className="sa-group flex flex-col gap-[var(--space-2)]" aria-labelledby="doc-lines-title">
                <h3 id="doc-lines-title" className="sa-section-title">שורות</h3>
                <ul className="sa-rows flex list-none flex-col divide-y divide-line-subtle">
                  {lines.map((l) => (
                    <li key={l.key} className="relative flex items-center gap-[var(--space-3)] py-[var(--space-2)]">
                      <ProductThumb product={l.product} />
                      <span className="sa-truncate min-w-0 flex-1">{l.name}</span>
                      {l.status ? <Badge tone={l.status.tone} dot={false}>{l.status.label}</Badge> : null}
                      <span className="shrink-0 text-end"><span className="sa-num">{fmtQty(l.qty)}</span>{l.unit ? ` ${fmtUnit(l.qty, l.unit)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </SidePanel>
        )}
      </div>

      {confirmDelete ? (
        <Modal
          title="למחוק את הרשומה?"
          tone="danger"
          confirmLabel="מחיקה"
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(false)}
        >
          <p className="m-0">{doc || fault?.photo_path ? "הרשומה והתמונה יימחקו לצמיתות." : "הרשומה תימחק לצמיתות."} המלאי לא ישתנה.</p>
        </Modal>
      ) : null}
    </>,
    document.body,
  );
}

/** Corrects what was typed on a record; the photo, the time and who reported it stay as they were. */
function EntryForm({ entry, onClose, children }: { entry: Entry; onClose: () => void; children?: ReactNode }) {
  const { state, updateDocument, updateFault } = useData();
  const { notify } = useUi();
  const form = useForm<"description">();
  const { doc, fault } = entry;

  const [supplierId, setSupplierId] = useState(doc?.supplier_id ?? "");
  const [customer, setCustomer] = useState(doc?.customer ?? "");
  const [description, setDescription] = useState(fault?.description ?? "");
  const [productId, setProductId] = useState(fault?.product_id ?? "");

  const submit = () => {
    if (fault && !description.trim()) {
      form.setErrors({ description: REQUIRED });
      return;
    }
    void form.run(async () => {
      if (doc) {
        await updateDocument(doc.id, doc.kind === "in" ? { supplier_id: supplierId || null } : { customer: customer.trim() || null });
      } else if (fault) {
        await updateFault(fault, { description: description.trim(), product_id: productId || null });
      }
      notify({ tone: "success", title: "השינויים נשמרו" });
      onClose();
    });
  };

  return (
    <FormPanel
      title={`עריכת ${KIND_LABEL[entry.kind]}`}
      subtitle={fmtFull(entry.at)}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="שמירה"
      busy={form.busy}
      error={form.error}
      onDismissError={() => form.setError(null)}
    >
      {children}
      {fault ? (
        <>
          <Input
            label="תיאור"
            required
            multiline
            value={description}
            onChange={(e) => { setDescription(e.target.value); form.clearField("description"); }}
            error={form.errors.description}
          />
          <Select label="מוצר" options={productOptions(state.products)} value={productId} onChange={setProductId} allLabel="ללא מוצר" block />
        </>
      ) : doc?.kind === "in" ? (
        <Select label="ספק" options={supplierOptions(state.suppliers)} value={supplierId} onChange={setSupplierId} placeholder="בחירת ספק" block />
      ) : (
        <Input label="לקוח" value={customer} onChange={(e) => setCustomer(e.target.value)} autoComplete="off" />
      )}
    </FormPanel>
  );
}
