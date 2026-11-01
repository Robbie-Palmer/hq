"use client";

import { useEffect } from "react";
import {
  ComponentCatalog,
  CurrentLayerManifest,
  DefaultHistory,
  ManifestSection,
  type PlatformManifestView,
} from "@/components/projects/platform-manifest-sections";

function useRevealManifestFragment() {
  useEffect(() => {
    const revealFragment = () => {
      const targetId = window.location.hash.slice(1);
      const target = targetId ? document.getElementById(targetId) : null;
      const section = target?.closest<HTMLDetailsElement>("details");
      if (section) section.open = true;
    };

    revealFragment();
    window.addEventListener("hashchange", revealFragment);
    return () => window.removeEventListener("hashchange", revealFragment);
  }, []);
}

export function PlatformManifest({
  manifest,
}: Readonly<{ manifest: PlatformManifestView }>) {
  useRevealManifestFragment();
  const instant = new Date().toISOString();
  return (
    <section className="space-y-4" aria-label="Platform manifest">
      <ManifestSection
        title="Component catalog"
        description="Repository components and their catalog IDs."
        count={`${manifest.catalog.records.length} records`}
      >
        <ComponentCatalog manifest={manifest} />
      </ManifestSection>
      <ManifestSection
        title="Current layer manifest"
        description="Active layers, activation rules, and slot policies."
        count={`${manifest.layers.length} layers`}
      >
        <CurrentLayerManifest manifest={manifest} instant={instant} />
      </ManifestSection>
      <ManifestSection
        title="Default history"
        description="Selections, decision history, adopters, and overrides."
        count={`${manifest.slots.length} slots`}
      >
        <DefaultHistory slots={manifest.slots} />
      </ManifestSection>
    </section>
  );
}
