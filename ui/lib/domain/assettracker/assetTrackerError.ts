/** A safe, user-facing failure caused by invalid persisted or imported data. */
export class AssetTrackerDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetTrackerDataError";
  }
}
