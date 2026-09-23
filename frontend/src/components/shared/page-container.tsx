import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Content wrapper: 24px page padding (16px below lg), 1760px max on wall displays. */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1760px] p-4 lg:p-6", className)}>{children}</div>;
}
