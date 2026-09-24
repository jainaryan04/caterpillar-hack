"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Monitor, Moon, Settings, Sun, User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSite } from "@/hooks/use-fleet-data";

/** There is no auth backend, so this menu names no one — it is the console's
 * own settings menu, not an account. */
export function UserMenu() {
  const { theme, setTheme } = useTheme();
  const site = useSite();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md p-1 hover:bg-raised"
        aria-label="Console menu"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-raised">
            <User className="size-4 text-muted-foreground" aria-hidden />
          </AvatarFallback>
        </Avatar>
        <span className="hidden flex-col text-left leading-tight xl:flex">
          <span className="text-small font-medium">Operations</span>
          <span className="text-caption text-muted-foreground">Not signed in</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-small font-medium">Operations console</span>
          <span className="text-caption font-normal text-muted-foreground">No sign-in configured · {site}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Moon /> Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="dark">
                <Moon /> Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">
                <Sun /> Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor /> System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
