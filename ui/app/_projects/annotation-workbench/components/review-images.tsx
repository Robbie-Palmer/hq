import { ImageIcon } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { assetUrl } from "../api/review-service";
import type {
  Proposal,
  ReviewItem,
  ReviewSession,
} from "../domain/review-contract";

type ReviewImagesProps = Readonly<{
  serviceUrl: string;
  session: ReviewSession;
  item: ReviewItem;
  proposal: Proposal;
  opacity: number;
  showReference: boolean;
  onOpacityChange: (value: number) => void;
}>;

export function ReviewImages({
  serviceUrl,
  session,
  item,
  proposal,
  opacity,
  showReference,
  onOpacityChange,
}: ReviewImagesProps) {
  const assets = new Map(
    session.bundle.assets.map((asset) => [asset.id, asset]),
  );
  const source = assets.get(item.source_asset_id);
  const proposalAsset = assets.get(proposal.asset_id);
  const referenceAsset = item.reference_asset_id
    ? assets.get(item.reference_asset_id)
    : undefined;
  if (!source || !proposalAsset) return null;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-2">
        <ImagePanel
          label="Source crop"
          src={assetUrl(serviceUrl, source.id)}
          alt={`Source crop for ${item.id}`}
        />
        <ImagePanel
          label={proposal.model_name}
          src={assetUrl(serviceUrl, source.id)}
          alt={`${proposal.model_name} proposal for ${item.id}`}
          overlaySrc={assetUrl(serviceUrl, proposalAsset.id)}
          overlayOpacity={opacity}
          referenceSrc={
            showReference && referenceAsset
              ? assetUrl(serviceUrl, referenceAsset.id)
              : undefined
          }
        />
      </div>
      <div className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <span className="text-sm font-medium">Proposal opacity</span>
        <Slider
          min={10}
          max={100}
          step={5}
          value={[opacity]}
          onValueChange={(values) => onOpacityChange(values[0] ?? opacity)}
          thumbLabels={["Proposal opacity"]}
          thumbValueTexts={[`${opacity}%`]}
        />
        <span className="font-mono text-xs text-muted-foreground">
          {opacity}%
        </span>
      </div>
    </section>
  );
}

function ImagePanel({
  label,
  src,
  alt,
  overlaySrc,
  overlayOpacity = 100,
  referenceSrc,
}: Readonly<{
  label: string;
  src: string;
  alt: string;
  overlaySrc?: string;
  overlayOpacity?: number;
  referenceSrc?: string;
}>) {
  return (
    <figure className="flex min-h-72 flex-col overflow-hidden rounded-xl border bg-muted/30">
      <figcaption className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        <ImageIcon aria-hidden className="size-4 text-muted-foreground" />
        {label}
      </figcaption>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
        <div className="relative max-h-[62vh] max-w-full">
          {/* Dynamic loopback assets cannot use the static Next image loader. */}
          {/* biome-ignore lint/performance/noImgElement: local review assets are runtime URLs */}
          <img
            src={src}
            alt={alt}
            className="max-h-[62vh] w-auto rounded-md bg-background object-contain shadow-sm [image-rendering:pixelated]"
          />
          {overlaySrc ? (
            /* biome-ignore lint/performance/noImgElement: local review assets are runtime URLs */
            <img
              src={overlaySrc}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 size-full rounded-md object-contain [image-rendering:pixelated]"
              style={{ opacity: overlayOpacity / 100 }}
            />
          ) : null}
          {referenceSrc ? (
            /* biome-ignore lint/performance/noImgElement: local review assets are runtime URLs */
            <img
              src={referenceSrc}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 size-full rounded-md object-contain [image-rendering:pixelated]"
            />
          ) : null}
        </div>
      </div>
    </figure>
  );
}
