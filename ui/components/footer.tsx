import { siteConfig } from "@/lib/config/site-config";
import { FooterLinks } from "./footer-links";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t mt-auto" data-site-chrome="footer">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center gap-4">
          <FooterLinks
            githubUrl={siteConfig.author.github}
            linkedInUrl={siteConfig.author.linkedin}
            sourceUrl={siteConfig.author.sourceRepo}
          />

          <p className="text-sm text-muted-foreground">
            {" · "}© {currentYear} {siteConfig.author.name}
          </p>
        </div>
      </div>
    </footer>
  );
}
