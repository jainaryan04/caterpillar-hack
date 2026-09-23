"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { NAV_GROUPS, SETTINGS_ITEM } from "@/config/nav";

function resolve(pathname: string): { group?: string; title: string; href: string } | null {
  for (const g of NAV_GROUPS) {
    const item = g.items.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
    if (item) return { group: g.label, title: item.title, href: item.href };
  }
  if (pathname.startsWith(SETTINGS_ITEM.href)) return { title: SETTINGS_ITEM.title, href: SETTINGS_ITEM.href };
  return null;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const crumb = resolve(pathname);
  if (!crumb) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-small">
        {crumb.group ? (
          <>
            <li className="hidden text-muted-foreground sm:block">{crumb.group}</li>
            <li className="hidden text-disabled-foreground sm:block" aria-hidden>
              <ChevronRight className="size-3.5" />
            </li>
          </>
        ) : null}
        <li className="truncate">
          <Link href={crumb.href} aria-current="page" className="font-medium text-foreground hover:underline">
            {crumb.title}
          </Link>
        </li>
      </ol>
    </nav>
  );
}
