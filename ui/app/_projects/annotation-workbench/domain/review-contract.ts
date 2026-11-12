import { z } from "zod";

const assetSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["source", "proposal", "reference"]),
    path: z.string().min(1),
    media_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const proposalSchema = z
  .object({
    id: z.string().min(1),
    asset_id: z.string().min(1),
    role: z.enum(["primary", "alternative", "baseline"]),
    model_name: z.string().min(1),
    model_revision: z.string().min(1),
    model_license: z.string().min(1),
    source_box_clipped: z.boolean(),
  })
  .strict();

const reviewContextSchema = z
  .object({
    dataset_id: z.string().min(1),
    source_item_id: z.string().min(1),
    source_annotation_id: z.string().min(1),
    split: z.enum(["train", "validation"]),
    site_id: z.string().min(1),
    class_name: z.string().min(1),
    bbox_xyxy: z.tuple([
      z.number().int(),
      z.number().int(),
      z.number().int(),
      z.number().int(),
    ]),
    coordinate_space: z.string().min(1),
  })
  .strict();

const reviewItemSchema = z
  .object({
    id: z.string().min(1),
    source_asset_id: z.string().min(1),
    reference_asset_id: z.string().min(1).nullable().optional(),
    proposals: z.array(proposalSchema).min(1),
    context: reviewContextSchema,
  })
  .strict();

export const reviewEventSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    event_id: z.uuid(),
    batch_id: z.string().min(1),
    item_id: z.string().min(1),
    reviewer_id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    reviewer_kind: z.enum(["human", "assistant"]),
    created_at: z.iso.datetime(),
    supersedes_event_id: z.uuid().nullable().optional(),
    object_decision: z.enum(["valid_nucleus", "non_nucleus", "uncertain"]),
    mask_decision: z.enum(["accept", "refine", "reject", "not_applicable"]),
    selected_proposal_id: z.string().min(1).nullable().optional(),
    notes: z.string().max(4000),
  })
  .strict();

export const reviewSessionSchema = z
  .object({
    bundle: z
      .object({
        schema_version: z.literal("1.0.0"),
        batch_id: z.string().min(1),
        created_at: z.iso.datetime(),
        provenance: z
          .object({
            producer: z.string().min(1),
            producer_version: z.string().min(1),
            producer_revision: z.string().regex(/^[a-f0-9]{64}$/),
            dataset_id: z.string().min(1),
            dataset_revision: z.string().min(1),
            derivation: z.string().min(1),
          })
          .strict(),
        assets: z.array(assetSchema).min(1),
        items: z.array(reviewItemSchema).min(1),
      })
      .strict(),
    latest_reviews: z.array(reviewEventSchema),
  })
  .strict();

export type ReviewSession = z.infer<typeof reviewSessionSchema>;
export type ReviewEvent = z.infer<typeof reviewEventSchema>;
export type ReviewItem = z.infer<typeof reviewItemSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type ObjectDecision = ReviewEvent["object_decision"];
export type MaskDecision = ReviewEvent["mask_decision"];
export type ReviewerKind = ReviewEvent["reviewer_kind"];
