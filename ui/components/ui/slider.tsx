"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import type * as React from "react";
import { cn } from "@/lib/generic/styles";

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> &
  Readonly<{
    thumbLabels?: readonly string[];
    thumbValueTexts?: readonly string[];
  }>;

function Slider({
  className,
  thumbLabels = [],
  thumbValueTexts = [],
  ...props
}: SliderProps) {
  const values = props.value ?? props.defaultValue ?? [props.min ?? 0];

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-2 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary"
        />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          data-slot="slider-thumb"
          aria-label={thumbLabels[index]}
          aria-valuetext={thumbValueTexts[index]}
          className="block size-5 shrink-0 rounded-full border-2 border-primary bg-background shadow-sm transition-[color,box-shadow] hover:ring-4 hover:ring-primary/15 focus-visible:ring-4 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
