"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ProjectTabsProps {
  projectSlug: string;
  pitch?: React.ReactNode;
  overview: React.ReactNode;
  adrs: React.ReactNode;
  adrCount: number;
  pdrs?: React.ReactNode;
  pdrCount?: number;
}

export function ProjectTabs({
  projectSlug,
  pitch,
  overview,
  adrs,
  adrCount,
  pdrs,
  pdrCount = 0,
}: Readonly<ProjectTabsProps>) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const requestedTab = searchParams.get("tab");
  const availableTabs = new Set([
    ...(pitch ? ["pitch"] : []),
    "overview",
    ...(adrCount > 0 ? ["adrs"] : []),
    ...(pdrCount > 0 ? ["pdrs"] : []),
  ]);
  const defaultTab = pitch ? "pitch" : "overview";
  const currentTab =
    requestedTab && availableTabs.has(requestedTab) ? requestedTab : defaultTab;

  const onTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    // Use replace to avoid filling history stack with tab changes,
    // scroll: false to maintain scroll position when switching tabs
    router.replace(
      `/projects/${encodeURIComponent(projectSlug)}?${params.toString()}`,
      { scroll: false },
    );
  };

  return (
    <Tabs value={currentTab} onValueChange={onTabChange} className="w-full">
      <TabsList className="w-full justify-start h-auto p-1 bg-muted rounded-md flex-wrap sm:inline-flex sm:w-auto sm:flex-nowrap">
        {pitch && (
          <TabsTrigger
            value="pitch"
            className="flex-1 sm:flex-none sm:w-[150px]"
          >
            Pitch deck
          </TabsTrigger>
        )}
        <TabsTrigger
          value="overview"
          className="flex-1 sm:flex-none sm:w-[150px]"
        >
          Overview
        </TabsTrigger>
        {adrCount > 0 && (
          <TabsTrigger
            value="adrs"
            className="flex-1 sm:flex-none sm:w-[250px]"
          >
            Architecture Decisions
            <Badge
              variant="secondary"
              className="ml-2 bg-muted-foreground/10 text-xs"
            >
              {adrCount}
            </Badge>
          </TabsTrigger>
        )}
        {pdrCount > 0 && (
          <TabsTrigger value="pdrs" className="flex-1 sm:flex-none">
            Product decisions
            <Badge variant="secondary" className="ml-2 text-xs">
              {pdrCount}
            </Badge>
          </TabsTrigger>
        )}
      </TabsList>

      {pitch && (
        <TabsContent
          value="pitch"
          className="animate-in fade-in-50 duration-500 mt-4"
        >
          {pitch}
        </TabsContent>
      )}

      <TabsContent
        value="overview"
        className="animate-in fade-in-50 duration-500 mt-4"
      >
        {overview}
      </TabsContent>

      {adrCount > 0 && (
        <TabsContent
          value="adrs"
          className="animate-in fade-in-50 duration-500 mt-4"
        >
          {adrs}
        </TabsContent>
      )}
      {pdrCount > 0 && (
        <TabsContent value="pdrs" className="mt-4">
          {pdrs}
        </TabsContent>
      )}
    </Tabs>
  );
}
