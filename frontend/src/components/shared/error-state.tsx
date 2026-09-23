import { RotateCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title: string;
  description?: string;
  onRetry?: () => void;
  /** Support reference shown under the message */
  errorId?: string;
  className?: string;
}

/** Widget / page error — spec §19. Keeps the rest of the page usable. */
export function ErrorState({ title, description, onRetry, errorId, className }: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)} role="alert">
      <TriangleAlert className="size-8 text-warning" aria-hidden />
      <h3 className="text-h3">{title}</h3>
      {description ? <p className="max-w-md text-small text-foreground-secondary">{description}</p> : null}
      {errorId ? <p className="font-mono text-caption text-muted-foreground">Ref {errorId}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCw /> Retry
        </Button>
      ) : null}
    </div>
  );
}
