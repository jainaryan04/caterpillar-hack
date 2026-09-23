import type { Manual } from "@/lib/types";

export const manuals: Manual[] = [
  { id: "cat-336-om", title: "Cat 336 Hydraulic Excavator", model: "336", docType: "Operation & Maintenance", pages: 486 },
  { id: "cat-793f-om", title: "Cat 793F Mining Truck", model: "793F", docType: "Operation & Maintenance", pages: 612 },
  { id: "cat-d8t-om", title: "Cat D8T Track-Type Tractor", model: "D8T", docType: "Operation & Maintenance", pages: 398 },
  { id: "cat-988k-om", title: "Cat 988K Wheel Loader", model: "988K", docType: "Operation & Maintenance", pages: 452 },
  { id: "site-safety", title: "Site Safety & Emergency Procedures", model: "All", docType: "Safety", pages: 74 },
];

export interface ChatCitation {
  n: number;
  page: number;
  section: string;
  excerpt: string;
}

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  /** Answer text from a manual WARNING/CAUTION block */
  caution?: string;
}

/** A demo conversation for the Cat 336 manual — spec §14, flow A3. */
export const demoConversation: ChatMessageData[] = [
  {
    id: "m1",
    role: "user",
    content: "Engine coolant temperature warning is on. What should I check?",
  },
  {
    id: "m2",
    role: "assistant",
    content:
      "Reduce engine load and let the engine run at low idle for 3–5 minutes before stopping it [1]. Once the engine has cooled:\n\n1. Check the coolant level in the sight gauge on the expansion tank [2].\n2. Inspect the radiator and hydraulic oil cooler cores for debris; clean with compressed air from the fan side [2].\n3. Check the fan drive belt tension and condition [3].\n\nIf the warning stays on at low idle, stop the machine and contact service.",
    caution:
      "Pressurized system: hot coolant can cause serious burns. Do not open the cooling system filler cap while the engine is hot.",
    citations: [
      { n: 1, page: 214, section: "Engine Overheating — Operating Procedure", excerpt: "If the coolant temperature indicator comes on, reduce the engine load and run the engine at low idle…" },
      { n: 2, page: 312, section: "Cooling System Coolant Level — Check", excerpt: "Check the coolant level when the engine is stopped and cool. Observe the sight gauge…" },
      { n: 3, page: 298, section: "Belts — Inspect/Adjust/Replace", excerpt: "Inspect the fan drive belt for wear, cracks and glazing. Belt tension should be…" },
    ],
  },
];

export const suggestedPrompts = [
  "Daily walk-around checklist",
  "Hydraulic oil change interval",
  "Warning light meanings",
  "Safe shutdown procedure",
];
