"use client";

import { Suspense } from "react";
import { MapPage } from "@/components/map3d/MapPage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MapPage />
    </Suspense>
  );
}
