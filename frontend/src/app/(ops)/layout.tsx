import { AppShell } from "@/components/shell/app-shell";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
