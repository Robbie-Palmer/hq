import type { ReactNode } from "react";

export interface FilterOption {
  value: string;
  label: string;
  icon?: ReactNode;
  group: string;
  paramName: string;
}

export interface PaletteTechnology {
  slug: string;
  name: string;
  iconSlug?: string;
  hasIcon: boolean;
}

export interface PaletteIdea {
  slug: string;
  title: string;
}

export interface PaletteBlogPost {
  slug: string;
  title: string;
}

export interface PaletteProject {
  slug: string;
  title: string;
}

export interface PaletteInitiative {
  slug: string;
  title: string;
}
