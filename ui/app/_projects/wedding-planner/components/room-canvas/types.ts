import type { TableAppearance } from "@/app/_projects/wedding-planner/application/room-layout";

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
