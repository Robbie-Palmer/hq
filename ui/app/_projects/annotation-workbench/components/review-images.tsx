import { Check, Eye, EyeOff, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/generic/styles";
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
  proposals: readonly Proposal[];
  selectedProposalId: string | null;
  opacity: number;
  showReference: boolean;
  onSelectProposal: (proposalId: string) => void;
  onOpacityChange: (value: number) => void;
  onReferenceChange: () => void;
}>;

export function ReviewImages({
  serviceUrl,
  session,
  item,
  proposals,
  selectedProposalId,
  opacity,
  showReference,
  onSelectProposal,
  onOpacityChange,
  onReferenceChange,
}: ReviewImagesProps) {
  const assets = new Map(
    session.bundle.assets.map((asset) => [asset.id, asset]),
  );
  const source = assets.get(item.source_asset_id);
  const reference = item.reference_asset_id
    ? assets.get(item.reference_asset_id)
    : undefined;
  if (!source) return null;

  return (
    <section className="min-w-0 space-y-3" aria-labelledby="comparison-title">
      <ComparisonToolbar
        referenceExists={Boolean(reference)}
        showReference={showReference}
        opacity={opacity}
        onOpacityChange={onOpacityChange}
        onReferenceChange={onReferenceChange}
      />
      <ProposalGrid
        serviceUrl={serviceUrl}
        item={item}
        proposals={proposals}
        assets={assets}
        sourceId={source.id}
        referenceId={showReference ? reference?.id : undefined}
        selectedProposalId={selectedProposalId}
        opacity={opacity}
        onSelectProposal={onSelectProposal}
      />
    </section>
  );
}

function ComparisonToolbar({
  referenceExists,
  showReference,
  opacity,
  onOpacityChange,
  onReferenceChange,
}: Readonly<{
  referenceExists: boolean;
  showReference: boolean;
  opacity: number;
  onOpacityChange: (value: number) => void;
  onReferenceChange: () => void;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
      <div className="mr-auto">
        <h2 id="comparison-title" className="font-semibold">
          Compare boundaries
        </h2>
        <p className="text-xs text-muted-foreground">
          Tap any proposal to choose it as the best boundary.
        </p>
      </div>
      {referenceExists ? (
        <Button
          type="button"
          size="sm"
          variant={showReference ? "secondary" : "outline"}
          aria-pressed={showReference}
          onClick={onReferenceChange}
        >
          {showReference ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {showReference ? "Hide reference" : "Show reference"}
        </Button>
      ) : null}
      <div className="grid w-full grid-cols-[auto_minmax(6rem,1fr)_auto] items-center gap-2 sm:w-72">
        <span className="text-xs font-medium">Opacity</span>
        <Slider
          min={10}
          max={100}
          step={5}
          value={[opacity]}
          onValueChange={(values) => onOpacityChange(values[0] ?? opacity)}
          thumbLabels={["Proposal opacity"]}
          thumbValueTexts={[`${opacity}%`]}
        />
        <span className="w-9 text-right font-mono text-xs text-muted-foreground">
          {opacity}%
        </span>
      </div>
    </div>
  );
}

type AssetMap = Map<string, ReviewSession["bundle"]["assets"][number]>;

function ProposalGrid({
  serviceUrl,
  item,
  proposals,
  assets,
  sourceId,
  referenceId,
  selectedProposalId,
  opacity,
  onSelectProposal,
}: Readonly<{
  serviceUrl: string;
  item: ReviewItem;
  proposals: readonly Proposal[];
  assets: AssetMap;
  sourceId: string;
  referenceId?: string;
  selectedProposalId: string | null;
  opacity: number;
  onSelectProposal: (proposalId: string) => void;
}>) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
      <ImageCard
        label="Source"
        sourceSrc={assetUrl(serviceUrl, sourceId)}
        alt={`Source crop for review item ${item.id}`}
      />
      {proposals.map((proposal) => {
        const proposalAsset = assets.get(proposal.asset_id);
        if (!proposalAsset) return null;
        return (
          <ImageCard
            key={proposal.id}
            label={proposal.model_name}
            sourceSrc={assetUrl(serviceUrl, sourceId)}
            alt={`${proposal.model_name} boundary proposal for review item ${item.id}`}
            overlaySrc={assetUrl(serviceUrl, proposalAsset.id)}
            overlayOpacity={opacity}
            referenceSrc={
              referenceId ? assetUrl(serviceUrl, referenceId) : undefined
            }
            selected={selectedProposalId === proposal.id}
            onSelect={() => onSelectProposal(proposal.id)}
          />
        );
      })}
    </div>
  );
}

type ImageCardProps = Readonly<{
  label: string;
  sourceSrc: string;
  alt: string;
  overlaySrc?: string;
  overlayOpacity?: number;
  referenceSrc?: string;
  selected?: boolean;
  onSelect?: () => void;
}>;

function ImageCard({
  label,
  sourceSrc,
  alt,
  overlaySrc,
  overlayOpacity = 100,
  referenceSrc,
  selected = false,
  onSelect,
}: ImageCardProps) {
  const content = (
    <>
      <ImageCardHeader
        label={label}
        referenceSrc={referenceSrc}
        selected={selected}
      />
      <ImageCanvas
        sourceSrc={sourceSrc}
        alt={alt}
        overlaySrc={overlaySrc}
        overlayOpacity={overlayOpacity}
        referenceSrc={referenceSrc}
      />
      {onSelect ? <ChoiceLabel selected={selected} /> : null}
    </>
  );

  const cardClassName = cn(
    "min-w-0 overflow-hidden rounded-xl border bg-card",
    selected && "border-primary bg-primary/5 ring-2 ring-primary/40",
  );

  if (!onSelect) {
    return <article className={cardClassName}>{content}</article>;
  }

  return (
    <button
      type="button"
      className={cn(
        cardClassName,
        "text-left transition-[border-color,box-shadow,transform] hover:border-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
      )}
      aria-label={`Choose ${label} as the best boundary`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

function ImageCardHeader({
  label,
  referenceSrc,
  selected,
}: Readonly<{ label: string; referenceSrc?: string; selected: boolean }>) {
  return (
    <div className="flex min-h-10 items-center gap-2 border-b px-2 py-1.5 text-xs font-medium sm:px-3 sm:text-sm">
      <ImageIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {referenceSrc ? (
        <span className="text-[10px] font-semibold tracking-wide text-primary">
          Reference
        </span>
      ) : null}
      {selected ? (
        <Check aria-label="Selected proposal" className="size-4" />
      ) : null}
    </div>
  );
}

function ImageCanvas({
  sourceSrc,
  alt,
  overlaySrc,
  overlayOpacity,
  referenceSrc,
}: Readonly<{
  sourceSrc: string;
  alt: string;
  overlaySrc?: string;
  overlayOpacity: number;
  referenceSrc?: string;
}>) {
  return (
    <div className="relative aspect-square w-full overflow-hidden bg-muted/30">
      {/* biome-ignore lint/performance/noImgElement: private review assets are runtime URLs */}
      <img
        src={sourceSrc}
        alt={alt}
        className="absolute inset-0 size-full object-contain [image-rendering:pixelated]"
      />
      {overlaySrc ? (
        /* biome-ignore lint/performance/noImgElement: private review assets are runtime URLs */
        <img
          src={overlaySrc}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full object-contain [image-rendering:pixelated]"
          style={{ opacity: overlayOpacity / 100 }}
        />
      ) : null}
      {referenceSrc ? (
        /* biome-ignore lint/performance/noImgElement: private review assets are runtime URLs */
        <img
          src={referenceSrc}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full object-contain [image-rendering:pixelated]"
          style={{
            filter:
              "drop-shadow(1px 0 0 white) drop-shadow(-1px 0 0 white) drop-shadow(0 1px 0 white) drop-shadow(0 -1px 0 white)",
          }}
        />
      ) : null}
    </div>
  );
}

function ChoiceLabel({ selected }: Readonly<{ selected: boolean }>) {
  return (
    <span
      className={cn(
        "flex h-9 items-center justify-center border-t text-xs font-medium sm:text-sm",
        selected
          ? "bg-primary text-primary-foreground"
          : "bg-muted/30 text-foreground",
      )}
    >
      {selected ? "Selected as best" : "Choose this boundary"}
    </span>
  );
}
