"use client";

import { Github, Linkedin, Rss } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { PageSourceLinks } from "@/components/page-source-links";

interface FooterLinksProps {
  linkedInUrl: string;
  githubUrl: string;
}

export function FooterLinks({
  linkedInUrl,
  githubUrl,
}: Readonly<FooterLinksProps>) {
  return (
    <>
      <div className="flex items-center gap-6">
        <Link
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground hover:opacity-60 transition-opacity"
          aria-label="GitHub"
          onClick={() =>
            posthog.capture("social_link_clicked", {
              platform: "github",
              url: githubUrl,
              location: "footer",
            })
          }
        >
          <Github className="h-6 w-6" />
        </Link>
        <Link
          href={linkedInUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground hover:opacity-60 transition-opacity"
          aria-label="LinkedIn"
          onClick={() =>
            posthog.capture("social_link_clicked", {
              platform: "linkedin",
              url: linkedInUrl,
              location: "footer",
            })
          }
        >
          <Linkedin className="h-6 w-6" />
        </Link>
        <a
          href="/feed.xml"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground hover:opacity-60 transition-opacity"
          aria-label="RSS feed"
          onClick={() =>
            posthog.capture("rss_feed_clicked", {
              feed: "global",
              location: "footer",
            })
          }
        >
          <Rss className="h-6 w-6" />
        </a>
      </div>

      <PageSourceLinks />
    </>
  );
}
