"use client";

import { useState } from "react";
import { FileText, MessageSquare } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { useManuals } from "@/hooks/use-fleet-data";
import { useQueryParam } from "@/hooks/use-query-param";
import { demoConversation, type ChatCitation, type ChatMessageData } from "@/lib/mock/manuals";
import { ChatPanel } from "./chat-panel";
import { PdfViewerPlaceholder } from "./pdf-viewer-placeholder";

const DEFAULT_MANUAL = "cat-336-om";

/** Manual assistant — spec §5.6 / §14: PDF left, chat right; citations jump to pages. */
export function AssistantView() {
  const { data: manuals } = useManuals();
  const [manualId, setManualId] = useQueryParam("manual");
  const manual = manuals?.find((m) => m.id === (manualId ?? DEFAULT_MANUAL)) ?? manuals?.[0];

  const [conversations, setConversations] = useState<Record<string, ChatMessageData[]>>({
    [DEFAULT_MANUAL]: demoConversation,
  });
  const [page, setPage] = useState(1);
  const [citation, setCitation] = useState<ChatCitation | null>(null);
  const [mobileTab, setMobileTab] = useState<"pdf" | "chat">("chat");

  if (!manual) {
    return (
      <div className="grid h-full gap-px lg:grid-cols-2">
        <Skeleton className="rounded-none" />
        <Skeleton className="rounded-none" />
      </div>
    );
  }

  const cite = (c: ChatCitation) => {
    setCitation(c);
    setPage(c.page);
    setMobileTab("pdf");
  };

  const pdf = (
    <PdfViewerPlaceholder
      manual={manual}
      page={page}
      onPageChange={(p) => {
        setPage(p);
        if (citation && citation.page !== p) setCitation(null);
      }}
      highlight={citation}
    />
  );
  const chat = (
    <ChatPanel
      manual={manual}
      messages={conversations[manual.id] ?? []}
      onMessagesChange={(msgs) => setConversations((c) => ({ ...c, [manual.id]: msgs }))}
      activeCitation={citation}
      onCite={cite}
    />
  );

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-panel px-4 py-2.5 lg:px-6">
        <h1 className="text-h2">Manual Assistant</h1>
        <Select
          value={manual.id}
          onValueChange={(id) => {
            setManualId(id);
            setPage(1);
            setCitation(null);
          }}
        >
          <SelectTrigger size="sm" className="h-9 w-72 max-w-full bg-inset" aria-label="Manual">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {manuals!.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.title}
                <span className="text-muted-foreground">{m.docType}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SegmentedControl
          ariaLabel="Panel"
          value={mobileTab}
          onChange={setMobileTab}
          className="ml-auto lg:hidden"
          options={[
            { value: "pdf", label: "Manual", icon: FileText },
            { value: "chat", label: "Chat", icon: MessageSquare },
          ]}
        />
      </div>

      {/* Desktop: resizable split, 35–65% */}
      <div className="hidden min-h-0 flex-1 lg:block">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="55%" minSize="35%" maxSize="65%">
            {pdf}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="45%" minSize="35%">
            {chat}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Below lg: tabs instead of a split */}
      <div className="min-h-0 flex-1 lg:hidden">{mobileTab === "pdf" ? pdf : chat}</div>
    </div>
  );
}
