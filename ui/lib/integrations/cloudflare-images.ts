const CF_IMAGES_ACCOUNT_HASH = process.env.NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH;

const CF_IMAGES_BASE_URL = "https://imagedelivery.net";

// Named variants (null = use flexible transformations without variant name)
export type ImageVariant = "og" | null;

export interface ImageTransformOptions {
  width?: number;
  height?: number;
  format?: "auto" | "webp" | "avif" | "json";
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  /** Image quality (1-100, default 85) */
  quality?: number;
  /** Device pixel ratio (1 or 2 for retina) */
  dpr?: 1 | 2;
}

/** Generates a Cloudflare Images URL. Use variant=null for flexible transformations. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function getImageUrl(
  imageId: string,
  variant: ImageVariant = null,
  options?: ImageTransformOptions,
): string {
  if (!CF_IMAGES_ACCOUNT_HASH) {
    throw new Error(
      "NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH environment variable is required. " +
        "Find your account hash in Cloudflare Dashboard > Images.",
    );
  }

  const baseUrl = `${CF_IMAGES_BASE_URL}/${CF_IMAGES_ACCOUNT_HASH}/${imageId}`;
  // For flexible transformations (no variant), use comma-separated parameters
  if (variant === null && options && Object.keys(options).length > 0) {
    const params: string[] = [];
    if (options.width) params.push(`w=${options.width}`);
    if (options.height) params.push(`h=${options.height}`);
    if (options.format) params.push(`f=${options.format}`);
    if (options.fit) params.push(`fit=${options.fit}`);
    if (options.quality) params.push(`q=${options.quality}`);
    if (options.dpr) params.push(`dpr=${options.dpr}`);
    return `${baseUrl}/${params.join(",")}`;
  }
  if (variant) {
    return `${baseUrl}/${variant}`;
  }
  return baseUrl;
}

/** Generates a responsive srcset string for the given image. */
export function getImageSrcSet(
  imageId: string,
  variant: ImageVariant = null,
  widths: number[] = [600, 1200, 2400],
  quality: number = 85,
): string {
  if (variant !== null) {
    // For named variants, just return the variant URL
    return `${getImageUrl(imageId, variant)} 1x`;
  }

  return widths
    .map((width) => {
      const url = getImageUrl(imageId, null, {
        width,
        format: "auto",
        quality,
      });
      return `${url} ${width}w`;
    })
    .join(", ");
}
