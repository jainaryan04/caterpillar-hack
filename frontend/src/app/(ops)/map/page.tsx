import type { Metadata } from "next";
import { Suspense } from "react";
import { MapView } from "@/features/map/map-view";

export const metadata: Metadata = { title: "Live Map" };

export default function MapPage() {
  return (
    <Suspense>
      <MapView />
    </Suspense>
  );
}
