import { Satellite } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageSourceLinks } from "@/components/page-source-links";
import { siteConfig } from "@/lib/config/site-config";

export const metadata: Metadata = {
  title: {
    default: "Autonomic Satellite Swarm",
    template: "%s | Autonomic Satellite Swarm",
  },
  description:
    "Run a deterministic C++ satellite-swarm mission in WebAssembly and inspect it on a CesiumJS globe.",
};

export default function SatelliteSwarmLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <nav className="container mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Link
            href="/satellite-swarm"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <Satellite className="h-5 w-5 text-sky-400" aria-hidden="true" />
            <span>Satellite Swarm</span>
          </Link>
          <div className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
            <Link
              href="/satellite-swarm#simulation"
              className="transition-colors hover:text-foreground"
            >
              Simulation
            </Link>
            <Link
              href="/projects/autonomic-satellite-swarm"
              className="transition-colors hover:text-foreground"
            >
              Project notes
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-auto border-t">
        <div className="container mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-6 text-center text-sm text-muted-foreground">
          <PageSourceLinks />
          <p>
            © {currentYear} {siteConfig.author.name}. Research prototype, not
            flight software.
          </p>
        </div>
      </footer>
    </div>
  );
}
