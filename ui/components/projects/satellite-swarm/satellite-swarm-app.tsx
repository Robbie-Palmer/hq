import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { siGithub } from "simple-icons";
import { Button } from "@/components/ui/button";
import { DeferredSatelliteSwarmSimulation } from "./deferred-satellite-swarm-simulation";

function GithubBrandIcon() {
  return (
    <svg aria-hidden="true" className="mr-2 h-4 w-4" viewBox="0 0 24 24">
      <path d={siGithub.path} fill="currentColor" />
    </svg>
  );
}

export function SatelliteSwarmApp() {
  return (
    <div className="bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.13),transparent_32rem)]">
      <section className="container mx-auto max-w-7xl px-4 pt-16 pb-8 sm:pt-24 sm:pb-12">
        <div className="max-w-3xl space-y-6">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-sky-400">
            Research prototype
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            Autonomic Satellite Swarm
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
            Run a deterministic three-node mission on a self-hosted CesiumJS
            globe, then inspect a lost assignment or a completed safe-state
            action. The existing C++ coordination code executes as WebAssembly
            in a browser worker, with no JavaScript copy of its decisions.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="#simulation">
                Open simulation
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a
                href="https://github.com/Robbie-Palmer/hq/tree/main/cpp/autonomic-satellite-swarm"
                target="_blank"
                rel="noopener noreferrer"
              >
                <GithubBrandIcon />
                View C++ source
              </a>
            </Button>
          </div>
        </div>
      </section>

      <section
        id="simulation"
        aria-labelledby="simulation-heading"
        className="scroll-mt-20 border-y bg-background/65"
      >
        <div className="container mx-auto max-w-7xl px-4 py-10 sm:py-14">
          <div className="max-w-3xl space-y-2">
            <h2
              id="simulation-heading"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              C++ mission simulation
            </h2>
            <p className="leading-7 text-muted-foreground">
              Choose a geographic objective and simulation scenario, run the
              portable C++ controller, and step through its request, candidate
              scores, messages, and final assignment. The C++ simulation
              propagates each node&apos;s fixed TLE with SGP4 and supplies the
              resulting orbit to both the controller and Cesium.
            </p>
          </div>
          <DeferredSatelliteSwarmSimulation />
        </div>
      </section>

      <section className="container mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:py-16 md:grid-cols-2">
        <div className="rounded-xl border bg-card/60 p-6">
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Execution
          </p>
          <h2 className="mb-3 text-xl font-semibold">C++ in a Web Worker</h2>
          <p className="leading-7 text-muted-foreground">
            Emscripten compiles the same controller and deterministic trace
            runner used by native tests. A versioned worker API returns the
            result to React without blocking the page.
          </p>
        </div>
        <div className="rounded-xl border bg-card/60 p-6">
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Presentation
          </p>
          <h2 className="mb-3 text-xl font-semibold">Self-hosted CesiumJS</h2>
          <p className="leading-7 text-muted-foreground">
            Cesium draws the Earth, SGP4-propagated node positions, message
            links, and selected objective. Its imagery, runtime assets, and
            WebAssembly module are served by this site without a Cesium ion
            token.
          </p>
        </div>
      </section>
    </div>
  );
}
