"use client";

import { ArrowDown, ArrowUp, Images, Plus } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  batchErrorMessage,
  confirmPhotoBatchManifest,
  type ImportBatch,
  photoBatchImagePath,
} from "@/lib/api/recipe-import-batches";

type EditableGroup = {
  key: string;
  title: string;
  imageIds: string[];
  locked: boolean;
};

function initialGroups(batch: ImportBatch): EditableGroup[] {
  if (batch.photoManifest) {
    const itemById = new Map(batch.items.map((item) => [item.id, item]));
    return batch.photoManifest.groups.map((group) => ({
      key: group.jobId,
      title: group.title ?? "",
      imageIds: group.imageIds,
      locked: itemById.get(group.jobId)?.status === "succeeded",
    }));
  }
  return (batch.photoImages ?? []).map((image) => ({
    key: crypto.randomUUID(),
    title: "",
    imageIds: [image.id],
    locked: false,
  }));
}

export function PhotoBatchGrouping({
  batch,
  onConfirmed,
}: Readonly<{
  batch: ImportBatch;
  onConfirmed: (batchId: string) => Promise<void>;
}>) {
  const images = batch.photoImages ?? [];
  const imageById = useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images],
  );
  const [groups, setGroups] = useState(() => initialGroups(batch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());

  function replaceGroups(next: EditableGroup[]) {
    setGroups(next);
    setSubmissionKey(crypto.randomUUID());
    setError(null);
  }

  function separateImages() {
    const lockedImageIds = new Set(
      groups.filter((group) => group.locked).flatMap((group) => group.imageIds),
    );
    replaceGroups([
      ...groups.filter((group) => group.locked),
      ...images
        .filter((image) => !lockedImageIds.has(image.id))
        .map((image) => ({
          key: crypto.randomUUID(),
          title: "",
          imageIds: [image.id],
          locked: false,
        })),
    ]);
  }

  function groupEditableImages() {
    const locked = groups.filter((group) => group.locked);
    const editableIds = groups
      .filter((group) => !group.locked)
      .flatMap((group) => group.imageIds);
    if (editableIds.length > 6) {
      setError("A recipe group can contain at most six pages.");
      return;
    }
    replaceGroups([
      ...locked,
      {
        key: crypto.randomUUID(),
        title: "",
        imageIds: editableIds,
        locked: false,
      },
    ]);
  }

  function moveGroup(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= groups.length) return;
    const next = [...groups];
    const currentGroup = next[index];
    const targetGroup = next[target];
    if (!currentGroup || !targetGroup) return;
    next[index] = targetGroup;
    next[target] = currentGroup;
    replaceGroups(next);
  }

  function movePage(groupIndex: number, imageIndex: number, offset: -1 | 1) {
    const next = groups.map((group) => ({
      ...group,
      imageIds: [...group.imageIds],
    }));
    const group = next[groupIndex];
    if (!group || group.locked) return;
    const target = imageIndex + offset;
    if (target < 0 || target >= group.imageIds.length) return;
    const currentImage = group.imageIds[imageIndex];
    const targetImage = group.imageIds[target];
    if (!currentImage || !targetImage) return;
    group.imageIds[imageIndex] = targetImage;
    group.imageIds[target] = currentImage;
    replaceGroups(next);
  }

  function movePageToGroup(
    sourceGroupIndex: number,
    imageId: string,
    targetGroupIndex: number,
  ) {
    const target = groups[targetGroupIndex];
    if (!target || target.locked || target.imageIds.length >= 6) {
      setError("Choose an editable group with fewer than six pages.");
      return;
    }
    const next = groups
      .map((group, index) => ({
        ...group,
        imageIds:
          index === sourceGroupIndex
            ? group.imageIds.filter((id) => id !== imageId)
            : index === targetGroupIndex
              ? [...group.imageIds, imageId]
              : [...group.imageIds],
      }))
      .filter((group) => group.locked || group.imageIds.length > 0);
    replaceGroups(next);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await confirmPhotoBatchManifest(batch.id, {
        idempotencyKey: submissionKey,
        expectedVersion: batch.photoManifest?.version ?? 0,
        groups: groups.map((group) => ({
          ...(group.title.trim() ? { title: group.title.trim() } : {}),
          imageIds: group.imageIds,
        })),
      });
      await onConfirmed(batch.id);
    } catch (cause) {
      setError(batchErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="my-4 rounded-lg border border-[var(--line)] p-4">
      <h2 className="rt-display text-2xl">Group recipe pages</h2>
      <p className="my-2 text-sm text-[var(--ink-3)]">
        Put every page in one recipe group, then order pages from first to last.
        Each recipe can contain one to six pages. Successful groups are locked
        when you regroup a failed import.
      </p>
      {error && (
        <p role="alert" className="my-3 text-destructive">
          {error}
        </p>
      )}
      <div className="my-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={separateImages}
        >
          <Images /> Each image is a recipe
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={groupEditableImages}
        >
          <Images /> Group editable pages
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() =>
            replaceGroups([
              ...groups,
              {
                key: crypto.randomUUID(),
                title: "",
                imageIds: [],
                locked: false,
              },
            ])
          }
        >
          <Plus /> Add recipe group
        </Button>
      </div>
      <div className="grid gap-4">
        {groups.map((group, groupIndex) => (
          <fieldset
            key={group.key}
            className="rounded-md border border-[var(--line)] p-3"
          >
            <legend className="px-1">Recipe {groupIndex + 1}</legend>
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label
                htmlFor={`photo-group-title-${group.key}`}
                className="min-w-52 flex-1"
              >
                <span className="mb-1 block text-sm">Optional title</span>
                <Input
                  id={`photo-group-title-${group.key}`}
                  value={group.title}
                  disabled={busy || group.locked}
                  onChange={(event) => {
                    const next = groups.map((value, index) =>
                      index === groupIndex
                        ? { ...value, title: event.target.value }
                        : value,
                    );
                    replaceGroups(next);
                  }}
                />
              </label>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Move recipe ${groupIndex + 1} earlier`}
                disabled={busy || groupIndex === 0}
                onClick={() => moveGroup(groupIndex, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Move recipe ${groupIndex + 1} later`}
                disabled={busy || groupIndex === groups.length - 1}
                onClick={() => moveGroup(groupIndex, 1)}
              >
                <ArrowDown />
              </Button>
            </div>
            {group.locked && (
              <p className="mb-2 text-sm text-[var(--ink-3)]">
                Draft ready. This group will be reused without another
                extraction.
              </p>
            )}
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.imageIds.map((imageId, imageIndex) => {
                const image = imageById.get(imageId);
                if (!image) return null;
                return (
                  <li
                    key={image.id}
                    className="rounded-md border border-[var(--line)] p-2"
                  >
                    <Image
                      src={photoBatchImagePath(batch.id, image.id)}
                      alt={`Page ${imageIndex + 1}: ${image.filename}`}
                      width={640}
                      height={480}
                      unoptimized
                      className="aspect-[4/3] w-full rounded object-contain"
                    />
                    <p className="mt-2 truncate text-sm">{image.filename}</p>
                    <div className="mt-2 flex gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Move ${image.filename} earlier`}
                        disabled={busy || group.locked || imageIndex === 0}
                        onClick={() => movePage(groupIndex, imageIndex, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Move ${image.filename} later`}
                        disabled={
                          busy ||
                          group.locked ||
                          imageIndex === group.imageIds.length - 1
                        }
                        onClick={() => movePage(groupIndex, imageIndex, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                    {!group.locked && groups.length > 1 && (
                      <label className="mt-2 block text-sm">
                        Recipe group
                        <select
                          aria-label={`Recipe group for ${image.filename}`}
                          value={groupIndex}
                          disabled={busy}
                          onChange={(event) =>
                            movePageToGroup(
                              groupIndex,
                              image.id,
                              Number(event.target.value),
                            )
                          }
                          className="mt-1 w-full rounded-md border border-[var(--line)] p-2"
                        >
                          {groups.map((target, targetIndex) => (
                            <option
                              key={target.key}
                              value={targetIndex}
                              disabled={
                                target.locked ||
                                (targetIndex !== groupIndex &&
                                  target.imageIds.length >= 6)
                              }
                            >
                              Recipe {targetIndex + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </li>
                );
              })}
            </ol>
          </fieldset>
        ))}
      </div>
      <Button
        type="button"
        className="mt-4"
        disabled={busy || groups.some((group) => group.imageIds.length === 0)}
        onClick={() => void confirm()}
      >
        Confirm grouping and start
      </Button>
    </section>
  );
}
