import type { AssetTrackerContextValue } from "./asset-tracker-provider";

export function selectAssetTrackerFields<
  const Fields extends readonly (keyof AssetTrackerContextValue)[],
>(...fields: Fields) {
  return (tracker: AssetTrackerContextValue) =>
    Object.fromEntries(fields.map((field) => [field, tracker[field]])) as Pick<
      AssetTrackerContextValue,
      Fields[number]
    >;
}
