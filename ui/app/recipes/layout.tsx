import type { Metadata, Viewport } from "next";
import { Caveat, JetBrains_Mono, Kalam } from "next/font/google";
import { AuthButton } from "@/components/recipes/auth-button";
import { CookingCompletionOutbox } from "@/components/recipes/cooking-completion-outbox";
import { DietProvider } from "@/components/recipes/diet-provider";
import { EquipmentReadinessProvider } from "@/components/recipes/equipment-readiness-provider";
import { NotificationBell } from "@/components/recipes/notifications/notification-bell";
import { RecipeAnalyticsIdentity } from "@/components/recipes/recipe-analytics-identity";
import { RecipeNavigationProvider } from "@/components/recipes/recipe-page-link";
import { RecipePwa } from "@/components/recipes/recipe-pwa";
import { RecipeQueryProvider } from "@/components/recipes/recipe-query-provider";
import { RecipeSiteNav } from "@/components/recipes/recipe-site-nav";
import { RecipeThemeBody } from "@/components/recipes/recipe-theme-body";
import { TimerDock } from "@/components/recipes/timer-dock";
import { CookModeProvider } from "@/contexts/cook-mode-context";
import { siteConfig } from "@/lib/config/site-config";
import "./recipe-theme.css";

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-caveat",
  display: "swap",
});

const kalam = Kalam({
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  variable: "--font-kalam",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Robbie's Recipes",
    template: "%s | Robbie's Recipes",
  },
  description: "A collection of my favorite recipes",
  manifest: "/recipes/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Recipes",
  },
  icons: {
    apple: "/recipes/icons/recipe-app-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#c8693c",
};

export default function RecipesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const currentYear = new Date().getFullYear();
  const fontVars = `${caveat.variable} ${kalam.variable} ${jetBrainsMono.variable}`;

  return (
    <RecipeQueryProvider>
      <RecipeAnalyticsIdentity />
      <CookingCompletionOutbox />
      <RecipeNavigationProvider>
        <CookModeProvider>
          {/* Mirror the theme + fonts onto <body> so portaled UI (mobile filter
          drawer, popovers) inherits the warm palette instead of the dark base. */}
          <RecipeThemeBody classNames={`recipe-theme ${fontVars}`} />
          <div
            className={`recipe-theme recipe-surface ${fontVars} antialiased flex flex-col min-h-screen`}
          >
            <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--paper)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--paper)]/75">
              <nav className="container mx-auto px-4 py-3 max-w-7xl flex flex-wrap items-center gap-x-4 gap-y-2">
                <a
                  href="/recipes"
                  className="order-1 min-w-0 shrink whitespace-nowrap rt-display text-2xl leading-none text-foreground min-[360px]:text-3xl"
                >
                  <span>Robbie's</span>{" "}
                  <span className="rt-logo-accent">recipes</span>
                </a>
                <div className="order-2 ms-auto flex shrink-0 items-center gap-2 sm:order-3">
                  <NotificationBell />
                  <AuthButton intent="signup" compactOnMobile />
                  <AuthButton compactOnMobile />
                </div>
                <div className="order-3 min-w-0 w-full sm:order-2 sm:flex-1">
                  <RecipeSiteNav />
                </div>
              </nav>
            </header>

            <RecipePwa />

            <DietProvider>
              <EquipmentReadinessProvider>
                <main className="relative z-0 flex-1 flex flex-col">
                  {children}
                </main>
              </EquipmentReadinessProvider>
            </DietProvider>

            <footer className="border-t border-[var(--line)] mt-auto">
              <div className="container mx-auto px-4 py-8">
                <div className="flex flex-col items-center gap-4">
                  <p className="rt-mono text-[var(--ink-3)]">
                    © {currentYear} {siteConfig.author.name}
                  </p>
                </div>
              </div>
            </footer>
          </div>

          {/* Outside the isolated .recipe-surface stacking context so it paints
          above the cook-mode overlay (which portals to <body>). Theme tokens
          come from the classes RecipeThemeBody mirrors onto <body>. */}
          <TimerDock />
        </CookModeProvider>
      </RecipeNavigationProvider>
    </RecipeQueryProvider>
  );
}
