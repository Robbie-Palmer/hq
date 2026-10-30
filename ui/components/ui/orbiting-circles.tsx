"use client";

import { cn } from "@/lib/generic/styles";

interface OrbitingCirclesProps {
  className?: string;
  children?: React.ReactNode;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  radius?: number;
  path?: boolean;
  iconSize?: number;
  style?: React.CSSProperties;
  paused?: boolean;
}

export function OrbitingCircles({
  className,
  children,
  reverse,
  duration = 20,
  delay = 10,
  radius = 50,
  path = true,
  iconSize = 30,
  style,
  paused = false,
}: Readonly<OrbitingCirclesProps>) {
  return (
    <>
      {path && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          version="1.1"
          className="pointer-events-none absolute inset-0 size-full"
        >
          <title>Orbit path</title>
          <circle
            className="stroke-black/10 stroke-1 dark:stroke-white/10"
            cx="50%"
            cy="50%"
            r={radius}
            fill="none"
          />
        </svg>
      )}

      <div
        style={
          {
            "--duration": duration,
            "--radius": radius,
            "--delay": -delay,
            "--icon-size": `${iconSize}px`,
            animationDelay: `calc(var(--delay) * 1000ms)`,
            animationDirection: reverse ? "reverse" : "normal",
            animationPlayState: paused ? "paused" : "running",
            willChange: paused ? "auto" : "transform",
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "absolute flex transform-gpu animate-orbit items-center justify-center rounded-full border-none",
          !style?.width && "size-full",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
