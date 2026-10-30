"use client";

import { ArrowDown, ArrowUp, Images, Plus } from "lucide-react";
import Image from "next/image";
import {
  type EditablePhotoGroup,
  usePhotoBatchGrouping,
} from "@/components/recipes/use-photo-batch-grouping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type ImportBatch,
  type PhotoBatchImage,
  photoBatchImagePath,
} from "@/lib/api/recipe-import-batches";

type Grouping = ReturnType<typeof usePhotoBatchGrouping>;

function GroupingActions({ grouping }: Readonly<{ grouping: Grouping }>) {
  return (
    <div className="my-3 flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={grouping.busy}
        onClick={grouping.separateImages}
      >
        <Images /> Each image is a recipe
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={grouping.busy}
        onClick={grouping.groupEditableImages}
      >
        <Images /> Group editable pages
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={grouping.busy}
        onClick={grouping.addGroup}
      >
        <Plus /> Add recipe group
      </Button>
    </div>
  );
}

function GroupHeader({
  group,
  index,
  grouping,
}: Readonly<{
  group: EditablePhotoGroup;
  index: number;
  grouping: Grouping;
}>) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <label
        htmlFor={`photo-group-title-${group.key}`}
        className="min-w-52 flex-1"
      >
        <span className="mb-1 block text-sm">Optional title</span>
        <Input
          id={`photo-group-title-${group.key}`}
          value={group.title}
          disabled={grouping.busy || group.locked}
          onChange={(event) => grouping.setTitle(index, event.target.value)}
        />
      </label>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={`Move recipe ${index + 1} earlier`}
        disabled={grouping.busy || index === 0}
        onClick={() => grouping.moveGroup(index, -1)}
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={`Move recipe ${index + 1} later`}
        disabled={grouping.busy || index === grouping.groups.length - 1}
        onClick={() => grouping.moveGroup(index, 1)}
      >
        <ArrowDown />
      </Button>
    </div>
  );
}

function PageGroupSelect({
  groupIndex,
  grouping,
  image,
}: Readonly<{
  groupIndex: number;
  grouping: Grouping;
  image: PhotoBatchImage;
}>) {
  return (
    <label className="mt-2 block text-sm">
      <span className="block">Recipe group</span>
      <select
        aria-label={`Recipe group for ${image.filename}`}
        value={groupIndex}
        disabled={grouping.busy}
        onChange={(event) =>
          grouping.movePageToGroup(
            groupIndex,
            image.id,
            Number(event.target.value),
          )
        }
        className="mt-1 w-full rounded-md border border-[var(--line)] p-2"
      >
        {grouping.groups.map((target, targetIndex) => (
          <option
            key={target.key}
            value={targetIndex}
            disabled={
              target.locked ||
              (targetIndex !== groupIndex && target.imageIds.length >= 6)
            }
          >
            Recipe {targetIndex + 1}
          </option>
        ))}
      </select>
    </label>
  );
}

function PageMoveButtons({
  group,
  groupIndex,
  grouping,
  image,
  imageIndex,
}: Readonly<{
  group: EditablePhotoGroup;
  groupIndex: number;
  grouping: Grouping;
  image: PhotoBatchImage;
  imageIndex: number;
}>) {
  return (
    <div className="mt-2 flex gap-1">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={`Move ${image.filename} earlier`}
        disabled={grouping.busy || group.locked || imageIndex === 0}
        onClick={() => grouping.movePage(groupIndex, imageIndex, -1)}
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={`Move ${image.filename} later`}
        disabled={
          grouping.busy ||
          group.locked ||
          imageIndex === group.imageIds.length - 1
        }
        onClick={() => grouping.movePage(groupIndex, imageIndex, 1)}
      >
        <ArrowDown />
      </Button>
    </div>
  );
}

function PhotoPage({
  batchId,
  group,
  groupIndex,
  grouping,
  image,
  imageIndex,
}: Readonly<{
  batchId: string;
  group: EditablePhotoGroup;
  groupIndex: number;
  grouping: Grouping;
  image: PhotoBatchImage;
  imageIndex: number;
}>) {
  return (
    <li className="rounded-md border border-[var(--line)] p-2">
      <Image
        src={photoBatchImagePath(batchId, image.id)}
        alt={`Page ${imageIndex + 1}: ${image.filename}`}
        width={640}
        height={480}
        unoptimized
        className="aspect-[4/3] w-full rounded object-contain"
      />
      <p className="mt-2 truncate text-sm">{image.filename}</p>
      <PageMoveButtons
        group={group}
        groupIndex={groupIndex}
        grouping={grouping}
        image={image}
        imageIndex={imageIndex}
      />
      {!group.locked && grouping.groups.length > 1 && (
        <PageGroupSelect
          groupIndex={groupIndex}
          grouping={grouping}
          image={image}
        />
      )}
    </li>
  );
}

function PhotoGroup({
  batchId,
  group,
  index,
  grouping,
}: Readonly<{
  batchId: string;
  group: EditablePhotoGroup;
  index: number;
  grouping: Grouping;
}>) {
  return (
    <fieldset className="rounded-md border border-[var(--line)] p-3">
      <legend className="px-1">Recipe {index + 1}</legend>
      <GroupHeader group={group} index={index} grouping={grouping} />
      {group.locked && (
        <p className="mb-2 text-sm text-[var(--ink-3)]">
          Draft ready. This group will be reused without another extraction.
        </p>
      )}
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {group.imageIds.map((imageId, imageIndex) => {
          const image = grouping.imageById.get(imageId);
          return image ? (
            <PhotoPage
              key={image.id}
              batchId={batchId}
              group={group}
              groupIndex={index}
              grouping={grouping}
              image={image}
              imageIndex={imageIndex}
            />
          ) : null;
        })}
      </ol>
    </fieldset>
  );
}

export function PhotoBatchGrouping({
  batch,
  onConfirmed,
}: Readonly<{
  batch: ImportBatch;
  onConfirmed: (batchId: string) => Promise<void>;
}>) {
  const grouping = usePhotoBatchGrouping(batch, onConfirmed);
  return (
    <section className="my-4 rounded-lg border border-[var(--line)] p-4">
      <h2 className="rt-display text-2xl">Group recipe pages</h2>
      <p className="my-2 text-sm text-[var(--ink-3)]">
        Put every page in one recipe group, then order pages from first to last.
        Each recipe can contain one to six pages. Successful groups are locked
        when you regroup a failed import.
      </p>
      {grouping.error && (
        <p role="alert" className="my-3 text-destructive">
          {grouping.error}
        </p>
      )}
      <GroupingActions grouping={grouping} />
      <div className="grid gap-4">
        {grouping.groups.map((group, index) => (
          <PhotoGroup
            key={group.key}
            batchId={batch.id}
            group={group}
            index={index}
            grouping={grouping}
          />
        ))}
      </div>
      <Button
        type="button"
        className="mt-4"
        disabled={
          grouping.busy ||
          grouping.groups.some((group) => group.imageIds.length === 0)
        }
        onClick={() => void grouping.confirm()}
      >
        Confirm grouping and start
      </Button>
    </section>
  );
}
