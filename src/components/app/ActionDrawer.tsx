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
import { PlaceForm } from "./forms/PlaceForm";
import { ProductForm } from "./forms/ProductForm";
import { SupplierForm } from "./forms/SupplierForm";
import { WorkerForm } from "./forms/WorkerForm";
import { AgentForm } from "./forms/AgentForm";
import { SupplierItemForm } from "./forms/SupplierItemForm";
import { MapSupplierItemForm } from "./forms/MapSupplierItemForm";
import { ReviewItemRequestForm } from "./forms/ReviewItemRequestForm";
import { SuppliersPanel } from "./forms/SuppliersPanel";
import "./drawers.css";

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
    case "place":
      return <PlaceForm ctx={ctx} />;
    case "new-product":
      return <ProductForm ctx={ctx} mode="new" />;
    case "edit-product":
      return <ProductForm ctx={ctx} mode="edit" />;
    case "new-supplier":
      return <SupplierForm ctx={ctx} mode="new" />;
    case "edit-supplier":
      return <SupplierForm ctx={ctx} mode="edit" />;
    case "new-worker":
      return <WorkerForm mode="new" />;
    case "edit-worker":
      return <WorkerForm ctx={ctx} mode="edit" />;
    case "new-agent":
      return <AgentForm mode="new" />;
    case "edit-agent":
      return <AgentForm ctx={ctx} mode="edit" />;
    case "new-supplier-item":
      return <SupplierItemForm ctx={ctx} />;
    case "map-supplier-item":
      return <MapSupplierItemForm ctx={ctx} />;
    case "review-item-request":
      return <ReviewItemRequestForm ctx={ctx} />;
    case "suppliers":
      return <SuppliersPanel />;
    default:
      return null;
  }
}

export function ActionDrawer() {
  const { panel } = useUi();
  if (!panel || panel.type !== "action") return null;
  const key = `${panel.kind}:${panel.ctx.productId ?? ""}:${panel.ctx.supplierId ?? ""}:${panel.ctx.supplierItemId ?? ""}:${panel.ctx.workerId ?? ""}:${panel.ctx.agentId ?? ""}:${panel.ctx.requestId ?? ""}:${panel.ctx.place ?? ""}:${panel.ctx.from ?? ""}`;
  return <FormFor key={key} kind={panel.kind} ctx={panel.ctx} />;
}
