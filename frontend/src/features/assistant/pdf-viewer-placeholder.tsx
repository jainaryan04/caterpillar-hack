"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, ListTree, Minus, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChatCitation } from "@/lib/mock/manuals";
import type { Manual } from "@/lib/types";

const ZOOMS = [75, 100, 125, 150] as const;
type Zoom = (typeof ZOOMS)[number];
const zoomWidth: Record<Zoom, string> = {
  75: "w-[420px]",
  100: "w-[560px]",
  125: "w-[700px]",
  150: "w-[840px]",
};

/* Placeholder body-text lines of varying lengths */
const LINE_WIDTHS = ["w-full", "w-11/12", "w-full", "w-10/12", "w-full", "w-9/12", "w-full", "w-11/12", "w-8/12"];

const OUTLINE = [
  { title: "Safety Section", page: 8 },
  { title: "Product Information", page: 46 },
  { title: "Operation Section", page: 88 },
  { title: "Engine Overheating", page: 214 },
  { title: "Maintenance Interval Schedule", page: 280 },
  { title: "Belts — Inspect/Adjust/Replace", page: 298 },
  { title: "Cooling System Coolant Level", page: 312 },
  { title: "Reference Information", page: 452 },
];

interface PdfViewerPlaceholderProps {
  manual: Manual;
  page: number;
  onPageChange: (page: number) => void;
  /** Citation currently highlighted, if it's on this page */
  highlight: ChatCitation | null;
}

/**
 * PDF viewer shell — spec §14. Toolbar, outline and highlight behaviour are
 * final; the page itself is a stand-in until react-pdf renders real manuals.
 */
export function PdfViewerPlaceholder({ manual, page, onPageChange, highlight }: PdfViewerPlaceholderProps) {
  const [zoom, setZoom] = useState<Zoom>(100);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [pageInput, setPageInput] = useState<string | null>(null);

  const go = (p: number) => onPageChange(Math.min(manual.pages, Math.max(1, p)));
  const zoomIdx = ZOOMS.indexOf(zoom);
  const section = highlight?.page === page ? highlight.section : OUTLINE.filter((o) => o.page <= page).at(-1)?.title;

  return (
    <div className="flex h-full min-h-0 flex-col bg-inset">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-panel px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOutlineOpen((o) => !o)}
          aria-pressed={outlineOpen}
          aria-label="Toggle outline"
        >
          <ListTree />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant="ghost" size="icon-sm" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pageInput) go(Number(pageInput));
            setPageInput(null);
          }}
          className="flex items-center gap-1 text-small"
        >
          <Input
            value={pageInput ?? String(page)}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
            onBlur={() => setPageInput(null)}
            inputMode="numeric"
            aria-label="Page number"
            className="h-7 w-12 px-1 text-center font-mono tabular-nums"
          />
          <span className="text-muted-foreground tabular-nums">/ {manual.pages}</span>
        </form>
        <Button variant="ghost" size="icon-sm" onClick={() => go(page + 1)} disabled={page >= manual.pages} aria-label="Next page">
          <ChevronRight />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant="ghost" size="icon-sm" onClick={() => setZoom(ZOOMS[Math.max(0, zoomIdx - 1)])} disabled={zoomIdx === 0} aria-label="Zoom out">
          <Minus />
        </Button>
        <span className="w-10 text-center font-mono text-caption tabular-nums">{zoom}%</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIdx + 1)])}
          disabled={zoomIdx === ZOOMS.length - 1}
          aria-label="Zoom in"
        >
          <Plus />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Search in document" onClick={() => toast.info("Search in PDF arrives with react-pdf")}>
            <Search />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Download PDF" onClick={() => toast.info("Download arrives with the manuals API")}>
            <Download />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {outlineOpen ? (
          <nav className="w-56 shrink-0 overflow-y-auto border-r bg-panel p-2" aria-label="Document outline">
            <ul className="flex flex-col gap-0.5">
              {OUTLINE.map((o) => (
                <li key={o.page}>
                  <button
                    type="button"
                    onClick={() => go(o.page)}
                    className={cn(
                      "flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-small hover:bg-raised",
                      section === o.title && "bg-raised font-medium",
                    )}
                  >
                    <span className="truncate">{o.title}</span>
                    <span className="font-mono text-caption text-muted-foreground">{o.page}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="min-w-0 flex-1 overflow-auto p-4 lg:p-6">
          <article
            className={cn(
              "mx-auto flex aspect-[1/1.294] max-w-full flex-col gap-4 rounded-sm bg-paper p-[6%] text-paper-foreground shadow-lg",
              zoomWidth[zoom],
            )}
            aria-label={`Page ${page}`}
          >
            <header className="flex items-center justify-between border-b border-paper-muted pb-2 text-[10px] tracking-wide uppercase">
              <span className="font-semibold">{manual.title}</span>
              <span>{manual.docType}</span>
            </header>
            <h2 className="text-h3">{section ?? "Introduction"}</h2>
            <div className="flex flex-col gap-2" aria-hidden>
              {LINE_WIDTHS.map((w, i) => (
                <div key={i} className={cn("h-2 rounded-full bg-paper-muted", w)} />
              ))}
            </div>
            {highlight?.page === page ? (
              <blockquote className="animate-in fade-in-0 rounded-sm border-l-4 border-brand bg-brand/20 py-2 pr-2 pl-3 text-small leading-relaxed duration-500">
                {highlight.excerpt}
              </blockquote>
            ) : null}
            <div className="flex flex-col gap-2" aria-hidden>
              {LINE_WIDTHS.slice(2).map((w, i) => (
                <div key={i} className={cn("h-2 rounded-full bg-paper-muted", w)} />
              ))}
            </div>
            <footer className="mt-auto flex justify-between border-t border-paper-muted pt-2 font-mono text-[10px]">
              <span>SEBU-{manual.model}</span>
              <span>{page}</span>
            </footer>
          </article>
          <p className="mt-3 text-center text-caption text-muted-foreground">
            Page preview placeholder — react-pdf renders the real manual in the integration phase.
          </p>
        </div>
      </div>
    </div>
  );
}
