"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BookOpenText, SendHorizontal, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { suggestedPrompts, type ChatCitation, type ChatMessageData } from "@/lib/mock/manuals";
import type { Manual } from "@/lib/types";
import { ChatMessage } from "./chat-message";

interface ChatPanelProps {
  manual: Manual;
  messages: ChatMessageData[];
  onMessagesChange: (messages: ChatMessageData[]) => void;
  activeCitation: ChatCitation | null;
  onCite: (c: ChatCitation) => void;
}

/**
 * Chat side of the manual assistant — spec §14. The AI endpoint isn't wired
 * yet, so sending a question returns a clearly-labelled placeholder reply.
 */
export function ChatPanel({ manual, messages, onMessagesChange, activeCitation, onCite }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q) return;
    onMessagesChange([
      ...messages,
      { id: `u-${messages.length}`, role: "user", content: q },
      {
        id: `a-${messages.length}`,
        role: "assistant",
        content: "The manual assistant isn't connected yet. Once the AI endpoint is integrated, answers with page citations from this manual will appear here.",
      },
    ]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="truncate text-small font-medium">Ask the manual</span>
        <Button variant="ghost" size="sm" onClick={() => onMessagesChange([])} disabled={messages.length === 0}>
          <SquarePen /> New chat
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <BookOpenText className="size-10 stroke-[1.25] text-muted-foreground" aria-hidden />
            <div>
              <h3 className="text-h3">Ask anything about the {manual.title}</h3>
              <p className="mt-1 text-small text-foreground-secondary">
                Answers cite the manual&apos;s pages. Click a citation to open that page.
              </p>
            </div>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {suggestedPrompts.map((p) => (
                <Button key={p} variant="secondary" size="sm" onClick={() => send(p)}>
                  {p}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            {messages.map((m) => (
              <ChatMessage key={m.id} message={m} activeCitation={activeCitation} onCite={onCite} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2 rounded-md border bg-inset p-1.5 focus-within:border-border-strong">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask about this manual…"
            aria-label="Question"
            className="max-h-36 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button size="icon" onClick={() => send(draft)} disabled={!draft.trim()} aria-label="Send question">
            <SendHorizontal />
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-caption text-muted-foreground">
          Searching: {manual.title} · Enter to send, Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
