export const previewScenarios = [
  {
    id: "empty-user",
    name: "Empty account",
    description: "A standard user with no saved recipes.",
    email: "empty-user@preview.invalid",
    role: "user",
  },
  {
    id: "user-with-recipes",
    name: "User with recipes",
    description:
      "A solo cook with private and public recipes who follows the household owner.",
    email: "recipes-user@preview.invalid",
    role: "user",
  },
  {
    id: "admin-user",
    name: "Administrator",
    description: "An administrator with representative recipe fixtures.",
    email: "admin-user@preview.invalid",
    role: "admin",
  },
  {
    id: "household-owner",
    name: "Household owner",
    description:
      "Owns a shared household with recipes that match and miss its kitchen equipment.",
    email: "household-owner@preview.invalid",
    role: "user",
  },
  {
    id: "household-member",
    name: "Household member",
    description:
      "Shares the household pantry and household-only recipes with the owner.",
    email: "household-member@preview.invalid",
    role: "user",
  },
] as const;

export type PreviewScenario = (typeof previewScenarios)[number];
export type PreviewScenarioId = PreviewScenario["id"];

export function findPreviewScenario(
  id: unknown,
): PreviewScenario | undefined {
  if (typeof id !== "string") return undefined;
  return previewScenarios.find((scenario) => scenario.id === id);
}
