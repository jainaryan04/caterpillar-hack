"use client";

import { useEffect, useState } from "react";
import { PageContainer } from "@/components/shared/page-container";
import { MetaDot, PageHeader } from "@/components/shared/page-header";
import { CameraTile } from "./camera-tile";
import { CAMERAS } from "./cameras";

/**
 * Monitoring — a CCTV wall of the computer-vision feeds. The clips already
 * carry their detections burned in; this page only plays them on a loop.
 */
export function MonitoringView() {
  // One clock for every tile; set after mount so server and client HTML match.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const wired = CAMERAS.filter((c) => c.src).length;

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="Monitoring"
        description={
          <>
            <span>{CAMERAS.length} cameras</span>
            <MetaDot />
            <span>{wired} with computer vision</span>
          </>
        }
      />
      <div className="grid gap-3 md:grid-cols-2">
        {CAMERAS.map((c) => (
          <CameraTile key={c.id} camera={c} now={now} />
        ))}
      </div>
    </PageContainer>
  );
}
