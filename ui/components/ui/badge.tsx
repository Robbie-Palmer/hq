import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/generic/styles";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "text-foreground bg-secondary border-secondary-foreground/20 [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
      interactive: {
        true: "cursor-pointer transition-colors border",
        false: "",
      },
      active: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      // Default variant interactive states
      {
        interactive: true,
        active: true,
        variant: "default",
        className: "hover:bg-primary/90 border-transparent",
      },
      {
        interactive: true,
        active: false,
        variant: "default",
        className:
          "hover:bg-primary/20 hover:text-primary hover:border-primary/30 border-transparent",
      },
      // Secondary variant interactive states
      {
        interactive: true,
        active: true,
        variant: "secondary",
        className: "hover:bg-secondary/90 border-transparent",
      },
      {
        interactive: true,
        active: false,
        variant: "secondary",
        className:
          "hover:bg-primary/20 hover:text-primary hover:border-primary/30 border-transparent",
      },
      // Destructive variant interactive states
      {
        interactive: true,
        active: true,
        variant: "destructive",
        className: "hover:bg-destructive/90 border-transparent",
      },
      {
        interactive: true,
        active: false,
        variant: "destructive",
        className:
          "hover:bg-destructive/20 hover:border-destructive/30 border-transparent",
      },
      // Outline variant interactive states
      {
        interactive: true,
        active: true,
        variant: "outline",
        className: "hover:bg-accent/90 border-transparent",
      },
      {
        interactive: true,
        active: false,
        variant: "outline",
        className: "hover:bg-accent/50 hover:border-accent border-transparent",
      },
    ],
    defaultVariants: {
      variant: "default",
      interactive: false,
      active: false,
    },
  },
);

function Badge({
  className,
  variant,
  interactive,
  active,
  asChild = false,
  ...props
}: React.HTMLAttributes<HTMLElement> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  let Comp: typeof Slot | "button" | "span" = "span";
  if (asChild) Comp = Slot;
  else if (props.onClick) Comp = "button";

  return (
    <Comp
      data-slot="badge"
      type={Comp === "button" ? "button" : undefined}
      className={cn(badgeVariants({ variant, interactive, active }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
