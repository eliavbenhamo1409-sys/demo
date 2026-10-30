"use client";

/**
 * Host for every action form. Reads useUi().panel (type === "action") and
 * renders the matching form inside a SidePanel. Each form owns its state, so
 * the `key` on the panel kind + ctx resets it whenever a different action opens.
 */
import { useUi, type ActionContext, type ActionKind } from "./ui-state";
import { ReceiveForm } from "./forms/ReceiveForm";
import { IssueForm } from "./forms/IssueForm";
import { FaultForm } from "./forms/FaultForm";
import { AdjustForm } from "./forms/AdjustForm";
import { ProductForm } from "./forms/ProductForm";
import { SupplierForm } from "./forms/SupplierForm";
import { WorkerForm } from "./forms/WorkerForm";
import { SupplierItemForm } from "./forms/SupplierItemForm";
import { MapSupplierItemForm } from "./forms/MapSupplierItemForm";

function FormFor({ kind, ctx }: { kind: ActionKind; ctx: ActionContext }) {
  switch (kind) {
    case "receive":
      return <ReceiveForm ctx={ctx} />;
    case "issue":
      return <IssueForm ctx={ctx} />;
    case "fault":
      return <FaultForm ctx={ctx} />;
    case "adjust":
      return <AdjustForm ctx={ctx} />;
    case "new-product":
      return <ProductForm ctx={ctx} mode="new" />;
    case "edit-product":
      return <ProductForm ctx={ctx} mode="edit" />;
    case "new-supplier":
      return <SupplierForm ctx={ctx} mode="new" />;
    case "edit-supplier":
      return <SupplierForm ctx={ctx} mode="edit" />;
    case "new-worker":
      return <WorkerForm />;
    case "new-supplier-item":
      return <SupplierItemForm ctx={ctx} />;
    case "map-supplier-item":
      return <MapSupplierItemForm ctx={ctx} />;
    default:
      return null;
  }
}

export function ActionDrawer() {
  const { panel } = useUi();
  if (!panel || panel.type !== "action") return null;
  const key = `${panel.kind}:${panel.ctx.productId ?? ""}:${panel.ctx.supplierId ?? ""}:${panel.ctx.supplierItemId ?? ""}:${panel.ctx.workerId ?? ""}`;
  return <FormFor key={key} kind={panel.kind} ctx={panel.ctx} />;
}
