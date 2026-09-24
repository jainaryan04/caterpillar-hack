import type { Metadata } from "next";
import { SimulationView } from "@/features/simulation/simulation-view";

export const metadata: Metadata = { title: "Schedule" };

export default function Page() {
  return <SimulationView />;
}
