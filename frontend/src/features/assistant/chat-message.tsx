"use client";

import { Copy, FileText, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ChatCitation, ChatMessageData } from "@/lib/mock/manuals";

interface ChatMessageProps {
  message: ChatMessageData;
  activeCitation: ChatCitation | null;
  onCite: (c: ChatCitation) => void;
}

/** Split "text [1] more [2]" into text runs and citation chips. */
function renderWithCitations(text: string, citations: ChatCitation[] | undefined, onCite: (c: ChatCitation) => void, active: ChatCitation | null) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    const c = m ? citations?.find((x) => x.n === Number(m[1])) : undefined;
    if (!c) return <span key={i}>{part}</span>;
    return (
      <button
        key={i}
        type="button"
        onClick={() => onCite(c)}
        title={`p.${c.page} · ${c.section}`}
        className={cn(
          "mx-0.5 inline-flex h-4.5 items-center rounded-sm border px-1 align-baseline font-mono text-[11px] leading-none text-foreground-secondary hover:border-foreground-secondary hover:text-foreground",
          active === c && "border-brand bg-brand/15 text-foreground",
        )}
        aria-label={`Source ${c.n}, page ${c.page}`}
      >
        {c.n}
      </button>
    );
  });
}

/** Chat message — spec §14. Assistant answers read like a document, full width, no bubble. */
export function ChatMessage({ message, activeCitation, onCite }: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-lg bg-raised px-3 py-2 text-body">{message.content}</p>
      </div>
    );
  }

  const paragraphs = message.content.split("\n\n");
  const uncited = !message.citations?.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 text-body leading-relaxed">
        {paragraphs.map((p, i) => {
          const lines = p.split("\n");
          const isList = lines.every((l) => /^\d+\.\s/.test(l));
          return isList ? (
            <ol key={i} className="flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground">
              {lines.map((l, j) => (
                <li key={j}>{renderWithCitations(l.replace(/^\d+\.\s/, ""), message.citations, onCite, activeCitation)}</li>
              ))}
            </ol>
          ) : (
            <p key={i}>{renderWithCitations(p, message.citations, onCite, activeCitation)}</p>
          );
        })}
      </div>

      {message.caution ? (
        <div className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-small" role="note">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            <span className="font-semibold">Caution — </span>
            {message.caution}
          </p>
        </div>
      ) : null}

      {uncited ? (
        <p className="flex items-center gap-1.5 text-small text-warning">
          <TriangleAlert className="size-4" aria-hidden /> No source found in this manual. Verify before acting.
        </p>
      ) : (
        <div className="rounded-md border">
          <h4 className="eyebrow border-b px-3 py-1.5">Sources</h4>
          <ul className="divide-y">
            {message.citations!.map((c) => (
              <li key={c.n}>
                <button
                  type="button"
                  onClick={() => onCite(c)}
                  className={cn("flex w-full gap-2 px-3 py-2 text-left hover:bg-raised", activeCitation === c && "bg-raised")}
                >
                  <span className="font-mono text-caption text-muted-foreground">[{c.n}]</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 text-small font-medium">
                      <FileText className="size-3.5 text-muted-foreground" aria-hidden />
                      p.{c.page} · {c.section}
                    </span>
                    <span className="line-clamp-1 text-caption text-muted-foreground">{c.excerpt}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-1 text-muted-foreground">
        <Button variant="ghost" size="icon-xs" aria-label="Helpful" onClick={() => toast.success("Thanks for the feedback")}>
          <ThumbsUp />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Not helpful" onClick={() => toast("Feedback noted")}>
          <ThumbsDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy answer"
          onClick={() => {
            void navigator.clipboard?.writeText(message.content);
            toast.success("Answer copied");
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}
