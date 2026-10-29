"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ProjectsPageTabsProps {
  initiatives: React.ReactNode;
  projects: React.ReactNode;
}

export function ProjectsPageTabs({
  initiatives,
  projects,
}: Readonly<ProjectsPageTabsProps>) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const requestedTab = searchParams.get("tab");
  const currentTab = requestedTab === "projects" ? requestedTab : "initiatives";

  useEffect(() => {
    if (requestedTab === "philosophy") {
      router.replace(`/building-philosophy${window.location.hash}`);
    }
  }, [requestedTab, router]);

  const onTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "initiatives") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    const queryString = params.toString();
    const querySuffix = queryString ? `?${queryString}` : "";
    // Use replace to avoid filling history stack with tab changes,
    // scroll: false to maintain scroll position when switching tabs
    router.replace(`/projects${querySuffix}`, { scroll: false });
  };

  return (
    <Tabs value={currentTab} onValueChange={onTabChange} className="w-full">
      <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
        <TabsList className="h-auto flex-1 justify-start rounded-md bg-muted p-1 sm:flex-none">
          <TabsTrigger
            value="initiatives"
            className="flex-1 sm:w-[150px] sm:flex-none"
          >
            Initiatives
          </TabsTrigger>
          <TabsTrigger
            value="projects"
            className="flex-1 sm:w-[150px] sm:flex-none"
          >
            All Projects
          </TabsTrigger>
        </TabsList>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="flex-1 text-muted-foreground sm:w-[200px] sm:flex-none"
        >
          <Link href="/building-philosophy">Building Philosophy</Link>
        </Button>
      </div>

      <TabsContent
        value="projects"
        className="animate-in fade-in-50 duration-500 mt-6"
      >
        {projects}
      </TabsContent>

      <TabsContent
        value="initiatives"
        className="animate-in fade-in-50 duration-500 mt-6"
      >
        {initiatives}
      </TabsContent>
    </Tabs>
  );
}
