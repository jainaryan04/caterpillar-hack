import { cn } from "@/lib/utils";
import { APP_NAME } from "@/config/site";

/** Wordmark: a yellow square mark + product name. Brand yellow use #1 of the allowed set. */
export function CatMark({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
          <path d="M12 4 21 19H3z" />
          <path d="M12 10.5 15.8 17H8.2z" className="fill-brand" />
        </svg>
      </span>
      {!collapsed ? (
        <span className="flex flex-col leading-none">
          <span className="text-caption font-semibold tracking-[0.08em] text-brand-text">CAT</span>
          <span className="text-body font-semibold text-foreground">{APP_NAME.replace(/^Cat /, "")}</span>
        </span>
      ) : (
        <span className="sr-only">{APP_NAME}</span>
      )}
    </span>
  );
}
