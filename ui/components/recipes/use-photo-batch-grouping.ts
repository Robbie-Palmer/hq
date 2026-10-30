"use client";

import { useMemo, useState } from "react";
import {
  batchErrorMessage,
  confirmPhotoBatchManifest,
  type ImportBatch,
} from "@/lib/api/recipe-import-batches";

export type EditablePhotoGroup = {
  key: string;
  title: string;
  imageIds: string[];
  locked: boolean;
};

function initialGroups(batch: ImportBatch): EditablePhotoGroup[] {
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

export function usePhotoBatchGrouping(
  batch: ImportBatch,
  onConfirmed: (batchId: string) => Promise<void>,
) {
  const images = batch.photoImages ?? [];
  const imageById = useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images],
  );
  const [groups, setGroups] = useState(() => initialGroups(batch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());
  function replaceGroups(next: EditablePhotoGroup[]) {
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
    const imageIds = groups
      .filter((group) => !group.locked)
      .flatMap((group) => group.imageIds);
    if (imageIds.length > 6) {
      setError("A recipe group can contain at most six pages.");
      return;
    }
    replaceGroups([
      ...locked,
      { key: crypto.randomUUID(), title: "", imageIds, locked: false },
    ]);
  }
  function addGroup() {
    replaceGroups([
      ...groups,
      { key: crypto.randomUUID(), title: "", imageIds: [], locked: false },
    ]);
  }
  function setTitle(index: number, title: string) {
    replaceGroups(
      groups.map((group, position) =>
        index === position ? { ...group, title } : group,
      ),
    );
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
    replaceGroups(
      groups
        .map((group, index) => ({
          ...group,
          imageIds:
            index === sourceGroupIndex
              ? group.imageIds.filter((id) => id !== imageId)
              : index === targetGroupIndex
                ? [...group.imageIds, imageId]
                : [...group.imageIds],
        }))
        .filter((group) => group.locked || group.imageIds.length > 0),
    );
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
  return {
    addGroup,
    busy,
    confirm,
    error,
    groupEditableImages,
    groups,
    imageById,
    moveGroup,
    movePage,
    movePageToGroup,
    separateImages,
    setTitle,
  };
}
