// SPDX-License-Identifier: AGPL-3.0-only

import type { MessageRow } from '../boot/client-data-db.js';

export interface BranchNavigationState {
  parentId: string | null;
  siblings: MessageRow[];
  index: number;
  count: number;
}

export interface BranchView {
  visibleMessages: MessageRow[];
  navigationByMessageId: Map<string, BranchNavigationState>;
}

/** Build the visible path through a message tree plus per-message branch controls. */
export function buildBranchView(
  messages: readonly MessageRow[],
  selectedChildByParentId: Readonly<Record<string, string>>,
): BranchView {
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  if (!sorted.some((message) => message.parentMessageId)) {
    return { visibleMessages: sorted, navigationByMessageId: new Map() };
  }

  const byParent = new Map<string | null, MessageRow[]>();
  const byId = new Map(sorted.map((m) => [m.id, m]));
  for (const message of sorted) {
    const parentId = message.parentMessageId ?? null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(message);
    byParent.set(parentId, siblings);
  }

  const latestByMessageId = new Map<string, number>();
  const latestInSubtree = (message: MessageRow, seen: Set<string>): number => {
    const cached = latestByMessageId.get(message.id);
    if (cached !== undefined) return cached;
    if (seen.has(message.id)) return message.createdAt;
    seen.add(message.id);
    let latest = message.createdAt;
    for (const child of byParent.get(message.id) ?? []) {
      latest = Math.max(latest, latestInSubtree(child, seen));
    }
    latestByMessageId.set(message.id, latest);
    return latest;
  };

  const chooseChild = (parentId: string | null, siblings: MessageRow[]): MessageRow => {
    const selectedId = selectedChildByParentId[parentId ?? ''];
    const selected = selectedId ? byId.get(selectedId) : undefined;
    if (selected && siblings.some((s) => s.id === selected.id)) return selected;
    return siblings.reduce((best, candidate) =>
      latestInSubtree(candidate, new Set()) > latestInSubtree(best, new Set()) ? candidate : best,
    );
  };

  const visibleMessages: MessageRow[] = [];
  const visit = (message: MessageRow, seen: Set<string>): void => {
    if (seen.has(message.id)) return;
    seen.add(message.id);
    visibleMessages.push(message);
    const children = byParent.get(message.id) ?? [];
    if (children.length > 0) visit(chooseChild(message.id, children), seen);
  };

  for (const root of byParent.get(null) ?? []) visit(root, new Set());

  const navigationByMessageId = new Map<string, BranchNavigationState>();
  for (const [parentId, siblings] of byParent) {
    if (parentId === null) continue;
    if (siblings.length < 2) continue;
    siblings.forEach((sibling, index) => {
      navigationByMessageId.set(sibling.id, {
        parentId,
        siblings,
        index,
        count: siblings.length,
      });
    });
  }

  return { visibleMessages, navigationByMessageId };
}
