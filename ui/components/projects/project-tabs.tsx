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

interface ProjectTab {
  value: string;
  label: string;
  content: React.ReactNode;
  count?: number;
}

function projectTabs({
  pitch,
  overview,
  adrs,
  adrCount,
  pdrs,
  pdrCount = 0,
}: ProjectTabsProps): ProjectTab[] {
  const tabs: ProjectTab[] = [
    { value: "overview", label: "Overview", content: overview },
  ];
  if (pitch)
    tabs.unshift({ value: "pitch", label: "Pitch deck", content: pitch });
  if (adrCount > 0)
    tabs.push({
      value: "adrs",
      label: "Architecture Decisions",
      content: adrs,
      count: adrCount,
    });
  if (pdrCount > 0)
    tabs.push({
      value: "pdrs",
      label: "Product decisions",
      content: pdrs,
      count: pdrCount,
    });
  return tabs;
}

export function ProjectTabs(props: Readonly<ProjectTabsProps>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabs = projectTabs(props);
  const requestedTab = searchParams.get("tab");
  const currentTab =
    tabs.find((tab) => tab.value === requestedTab)?.value ?? tabs[0]?.value;
  const onTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(
      `/projects/${encodeURIComponent(props.projectSlug)}?${params.toString()}`,
      { scroll: false },
    );
  };
  return (
    <Tabs value={currentTab} onValueChange={onTabChange} className="w-full">
      <TabsList className="w-full max-w-full justify-start h-auto p-1 bg-muted rounded-md flex-wrap sm:inline-flex sm:w-auto">
        {tabs.map((tab) => (
          <ProjectTabTrigger key={tab.value} tab={tab} />
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="animate-in fade-in-50 duration-500 mt-4"
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function ProjectTabTrigger({ tab }: Readonly<{ tab: ProjectTab }>) {
  return (
    <TabsTrigger
      value={tab.value}
      className={
        tab.count === undefined
          ? "flex-1 sm:flex-none sm:w-[150px]"
          : "flex-1 sm:flex-none sm:w-[250px]"
      }
    >
      {tab.label}
      {tab.count !== undefined && (
        <Badge
          variant="secondary"
          className="ml-2 bg-muted-foreground/10 text-xs"
        >
          {tab.count}
        </Badge>
      )}
    </TabsTrigger>
  );
}
