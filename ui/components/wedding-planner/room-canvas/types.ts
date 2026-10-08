import type { TableAppearance } from "@/lib/wedding-planner/room-layout";

export type RoomTable = {
  id: string;
  capacity: number;
  appearance: TableAppearance;
  occupants: string[];
};
export type Palette = {
  ink: string;
  paper: string;
  sage: string;
  line: string;
  softInk: string;
};
