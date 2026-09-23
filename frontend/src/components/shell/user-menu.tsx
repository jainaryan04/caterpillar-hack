"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { LogOut, Monitor, Moon, Settings, Sun, User } from "lucide-react";
import { toast } from "sonner";
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
import { CURRENT_USER } from "@/config/site";

export function UserMenu() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md p-1 hover:bg-raised"
        aria-label={`Account: ${CURRENT_USER.name}`}
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-raised text-caption font-semibold">{CURRENT_USER.initials}</AvatarFallback>
        </Avatar>
        <span className="hidden flex-col text-left leading-tight xl:flex">
          <span className="text-small font-medium">{CURRENT_USER.name}</span>
          <span className="text-caption text-muted-foreground">{CURRENT_USER.role}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-small font-medium">{CURRENT_USER.name}</span>
          <span className="text-caption font-normal text-muted-foreground">{CURRENT_USER.role} · Pit 3 North</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <User /> Profile
          </Link>
        </DropdownMenuItem>
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => toast.info("Sign-out is not connected yet")}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
