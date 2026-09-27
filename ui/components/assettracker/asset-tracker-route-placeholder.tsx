import Link from "next/link";

interface AssetTrackerRoutePlaceholderProps {
  title: string;
  description: string;
}

export function AssetTrackerRoutePlaceholder({
  title,
  description,
}: Readonly<AssetTrackerRoutePlaceholderProps>) {
  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          Asset Tracker
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="max-w-2xl text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-lg border border-dashed p-6">
        <p className="font-medium">This section is ready for extraction.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Its existing tools remain available on the overview while they move
          here in the next implementation slices.
        </p>
        <Link
          href="/assettracker"
          className="mt-4 inline-flex min-h-10 items-center text-sm font-medium underline underline-offset-4"
        >
          Return to overview
        </Link>
      </div>
    </section>
  );
}
