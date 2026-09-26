"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  FlaskConical,
  LoaderCircle,
  LogIn,
  LogOut,
  Settings,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  type Provider,
  ProviderIcon,
  AUTH_PROVIDERS as providers,
} from "@/components/recipes/auth-providers";
import { RecipeAvatar } from "@/components/recipes/recipe-avatar";
import { clearOfflineRecipeData } from "@/components/recipes/recipe-pwa";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiRequest } from "@/lib/api/http";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/generic/styles";
import { isPreviewDeployment } from "@/lib/preview-environment";
import { clearPrivateRecipeQueries } from "@/lib/query/recipe-query-client";

type PreviewScenario = {
  id: string;
  name: string;
  description: string;
};

export function redirectAfterSignOut(
  _context?: unknown,
  replace: (url: string) => void = window.location.replace.bind(
    window.location,
  ),
) {
  replace("/recipes");
}

function authPrompt(
  isPreview: boolean,
  previewBackendDisabled: boolean,
  intent: "signin" | "signup",
): string {
  if (isPreview) {
    if (previewBackendDisabled) return "Sign-in unavailable";
    if (intent === "signup") return "Start a fresh preview account";
    return "Choose a preview scenario";
  }
  return intent === "signup"
    ? "Create your recipe box"
    : "Log in to your recipes";
}

type AuthOptionsProps = {
  isPreview: boolean;
  intent: "signin" | "signup";
  pendingSignIn: string | null;
  previewScenarios: PreviewScenario[] | null;
  lastUsedProvider: Provider | null;
  previewSignUp: () => Promise<void>;
  previewSignIn: (scenario: PreviewScenario) => Promise<void>;
  signIn: (provider: Provider) => Promise<void>;
};

function AuthOptions({
  isPreview,
  intent,
  pendingSignIn,
  previewScenarios,
  lastUsedProvider,
  previewSignUp,
  previewSignIn,
  signIn,
}: Readonly<AuthOptionsProps>) {
  if (isPreview && intent === "signup") {
    return (
      <Button
        variant="ghost"
        className="h-auto w-full justify-start py-2"
        disabled={pendingSignIn !== null}
        onClick={previewSignUp}
      >
        {pendingSignIn === "fresh-signup" ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <FlaskConical />
        )}
        <span className="min-w-0 text-left">
          <span className="block">Start fresh</span>
          <span className="block whitespace-normal text-xs font-normal text-muted-foreground">
            Create a new empty QA account
          </span>
        </span>
      </Button>
    );
  }

  if (isPreview) {
    return previewScenarios?.map((scenario) => (
      <Button
        key={scenario.id}
        variant="ghost"
        className="h-auto w-full justify-start py-2"
        disabled={pendingSignIn !== null}
        onClick={() => previewSignIn(scenario)}
      >
        {pendingSignIn === scenario.id ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <FlaskConical />
        )}
        <span className="min-w-0 text-left">
          <span className="block">{scenario.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {scenario.description}
          </span>
        </span>
      </Button>
    ));
  }

  return providers.map((provider) => (
    <Button
      key={provider.id}
      variant="ghost"
      className="w-full justify-start"
      disabled={pendingSignIn !== null}
      onClick={() => signIn(provider.id)}
    >
      {pendingSignIn === provider.id ? (
        <LoaderCircle className="animate-spin" />
      ) : (
        <ProviderIcon path={provider.iconPath} />
      )}
      Continue with {provider.name}
      {lastUsedProvider === provider.id && (
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
          Last used
        </span>
      )}
    </Button>
  ));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function AuthButton({
  className,
  compactOnMobile = false,
  intent = "signin",
  label,
  signOutRedirect = redirectAfterSignOut,
}: Readonly<{
  className?: string;
  compactOnMobile?: boolean;
  intent?: "signin" | "signup";
  label?: string;
  signOutRedirect?: () => void;
}>) {
  const previewBackendDisabled =
    process.env.NEXT_PUBLIC_PREVIEW_BACKEND === "false";
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();
  const triggerLabel = label ?? (intent === "signup" ? "Sign up" : "Log in");
  const [open, setOpen] = useState(false);
  const [pendingSignIn, setPendingSignIn] = useState<string | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [previewScenarios, setPreviewScenarios] = useState<
    PreviewScenario[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUsedProvider, setLastUsedProvider] = useState<Provider | null>(
    null,
  );

  // Read from the client-side cookie after mount to avoid a hydration mismatch.
  useEffect(() => {
    const method = authClient.getLastUsedLoginMethod();
    if (method === "google" || method === "github") {
      setLastUsedProvider(method);
    }
  }, []);

  useEffect(() => {
    const preview = isPreviewDeployment(window.location.hostname);
    setIsPreview(preview);
    if (!preview) return;

    if (previewBackendDisabled) {
      setError("Sign-in is disabled on this frontend-only preview.");
      return;
    }

    if (intent === "signup") return;

    void apiRequest<PreviewScenario[]>("/api/auth/preview/scenarios", {
      fallbackMessage: "Preview scenarios unavailable",
    })
      .then(setPreviewScenarios)
      .catch(() => setError("Preview sign-in is not configured."));
  }, [intent, previewBackendDisabled]);

  async function signOut() {
    setError(null);
    try {
      const result = await authClient.signOut({
        fetchOptions: {
          onSuccess: async () => {
            try {
              await clearPrivateRecipeQueries(queryClient);
            } finally {
              await clearOfflineRecipeData().catch(() => {
                // Local cleanup is best-effort; the signed-out user must leave.
              });
              signOutRedirect();
            }
          },
        },
      });
      if (result?.error) {
        setError(result.error.message ?? "Sign-out failed. Please try again.");
      }
    } catch {
      setError("Sign-out failed. Please try again.");
    }
  }

  if (isPending) {
    return (
      <>
        <Skeleton
          aria-hidden="true"
          className={intent === "signup" ? "h-9 w-20" : "h-9 w-16"}
        />
        <output
          aria-label="Loading session"
          aria-live="polite"
          className="sr-only"
        >
          Loading session…
        </output>
      </>
    );
  }

  if (session && intent === "signup") return null;

  if (session) {
    return (
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={`Account for ${session.user.name}`}
            aria-expanded={open}
            className="rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--terracotta)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] data-[state=open]:ring-2 data-[state=open]:ring-[var(--terracotta)] data-[state=open]:ring-offset-2 data-[state=open]:ring-offset-[var(--paper)]"
          >
            <RecipeAvatar
              name={session.user.name}
              email={session.user.email}
              image={session.user.image}
              size={36}
            />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="end"
            sideOffset={8}
            className="bg-popover text-popover-foreground z-50 w-64 overflow-hidden rounded-xl border shadow-md outline-none"
          >
            <div className="flex items-center gap-3 border-b bg-[var(--paper-warm)] px-4 py-3">
              <RecipeAvatar
                name={session.user.name}
                email={session.user.email}
                image={session.user.image}
                size={40}
              />
              <div className="min-w-0">
                <p className="rt-display flex items-center gap-2 text-lg leading-none">
                  {session.user.name}
                  {session.user.role === "admin" && (
                    <span className="rt-mono rounded bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">
                      Admin
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {session.user.email}
                </p>
              </div>
            </div>

            <div className="p-1.5">
              <Button
                variant="ghost"
                className="w-full justify-start"
                asChild
                onClick={() => setOpen(false)}
              >
                <a href="/recipes/profile">
                  <UserRound />
                  Profile
                </a>
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                asChild
                onClick={() => setOpen(false)}
              >
                <a href="/recipes/settings">
                  <Settings />
                  Settings
                </a>
              </Button>
            </div>

            <div className="border-t p-1.5">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={signOut}
              >
                <LogOut />
                Sign out
              </Button>
            </div>

            {error && (
              <p role="alert" className="px-3 pb-3 text-xs text-destructive">
                {error}
              </p>
            )}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  }

  async function signIn(provider: Provider) {
    setPendingSignIn(provider);
    setError(null);

    const currentURL =
      intent === "signup" ? "/recipes/onboarding" : window.location.href;
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: currentURL,
        errorCallbackURL: currentURL,
      });
      if (result.error) {
        setError(result.error.message ?? "Sign-in could not be started.");
      }
    } catch {
      setError("Sign-in could not be started. Please try again.");
    } finally {
      setPendingSignIn(null);
    }
  }

  async function previewSignIn(scenario: PreviewScenario) {
    setPendingSignIn(scenario.id);
    setError(null);
    try {
      await apiRequest<void>("/api/auth/preview/sign-in", {
        method: "POST",
        json: { scenario: scenario.id },
        responseType: "void",
        fallbackMessage: "Preview sign-in failed.",
      });
      if (intent === "signup") {
        window.location.assign("/recipes/onboarding");
      } else {
        window.location.reload();
      }
    } catch (previewError) {
      setError(
        previewError instanceof ApiError
          ? previewError.message
          : "Preview sign-in failed.",
      );
    } finally {
      setPendingSignIn(null);
    }
  }

  async function previewSignUp() {
    setPendingSignIn("fresh-signup");
    setError(null);
    try {
      await apiRequest<void>("/api/auth/preview/sign-up", {
        method: "POST",
        responseType: "void",
        fallbackMessage: "Preview sign-up failed.",
      });
      window.location.assign("/recipes/onboarding");
    } catch (previewError) {
      setError(
        previewError instanceof ApiError
          ? previewError.message
          : "Preview sign-up failed.",
      );
    } finally {
      setPendingSignIn(null);
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          variant={intent === "signup" ? "default" : "outline"}
          size="sm"
          aria-label={compactOnMobile ? triggerLabel : undefined}
          aria-expanded={open}
          className={cn(
            intent === "signup" &&
              "max-w-full rounded-full bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]",
            className,
          )}
        >
          {intent === "signup" ? <UserPlus /> : <LogIn />}
          <span
            className={cn(
              "min-w-0 truncate",
              compactOnMobile && "hidden min-[480px]:inline",
            )}
          >
            {triggerLabel}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 opacity-60",
              compactOnMobile && "hidden min-[480px]:block",
            )}
          />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="bg-popover text-popover-foreground z-50 w-[calc(100vw-2rem)] max-w-56 rounded-md border p-2 shadow-md outline-none"
        >
          <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
            {authPrompt(isPreview, previewBackendDisabled, intent)}
          </p>
          <div className="flex flex-col gap-1">
            <AuthOptions
              isPreview={isPreview}
              intent={intent}
              pendingSignIn={pendingSignIn}
              previewScenarios={previewScenarios}
              lastUsedProvider={lastUsedProvider}
              previewSignUp={previewSignUp}
              previewSignIn={previewSignIn}
              signIn={signIn}
            />
            {isPreview &&
              intent === "signin" &&
              previewScenarios === null &&
              !error && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                  <LoaderCircle className="animate-spin" />
                  Loading scenarios…
                </div>
              )}
          </div>
          {error && (
            <p role="alert" className="px-2 pt-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
