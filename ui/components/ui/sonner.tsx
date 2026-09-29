"use client";

import { useSyncExternalStore } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const subscribe = (callback: () => void) => {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-sonner-theme"],
  });
  return () => observer.disconnect();
};

const getSnapshot = (): "light" | "dark" => {
  const override = document.documentElement.dataset.sonnerTheme;
  if (override === "light" || override === "dark") return override;
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
};

const getServerSnapshot = (): "light" | "dark" => "dark";

const classNames = {
  toast:
    "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
  description: "group-[.toast]:text-muted-foreground",
  actionButton:
    "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
  cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
};

const toastOptions = { classNames };

export function Toaster({ theme: propsTheme, ...props }: ToasterProps) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <Sonner
      theme={propsTheme ?? theme}
      className="toaster group"
      position="bottom-center"
      swipeDirections={["left", "right", "bottom"]}
      toastOptions={toastOptions}
      {...props}
    />
  );
}
