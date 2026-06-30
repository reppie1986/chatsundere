// SPDX-License-Identifier: AGPL-3.0-only

import { uuidv7 } from 'uuidv7';
import { getClientDataDb } from '../boot/client-data-db.js';
import type { ParsedConversation, ParsedTurn } from '../lib/grok-import/types.js';

/**
 * Preview which of the given conversations would be new vs. already imported
 * for a persona. `personaId` null means create mode (all new).
 */
export async function previewGrokConversations(
  personaId: string | null,
  conversations: ParsedConversation[],
): Promise<{ newConversations: ParsedConversation[]; existingIds: Set<string> }> {
  if (!personaId) return { newConversations: conversations, existingIds: new Set() };

  const db = getClientDataDb();
  const existing = await db.chats.where('personaId').equals(personaId).toArray();
  const seen = new Set(
    existing
      .map((c) => c.importedFrom)
      .filter((v): v is string => !!v && v.startsWith('grok/'))
      .map((v) => v.slice(5)),
  );

  const newConvs = conversations.filter((c) => !seen.has(c.id));
  return { newConversations: newConvs, existingIds: seen };
}

export interface ImportGrokOptions {
  /** Whether to preserve all Grok branches in the imported chat. */
  preserveBranches?: boolean;
  /** @deprecated Use preserveBranches. Kept so the dialog call-site stays compatible. */
  importBranchesAsSeparateChats?: boolean;
}

export interface ImportGrokResult {
  imported: number;
  skipped: number;
}

/**
 * Import selected Grok conversations into an existing persona.
 * Idempotent: conversations already imported (by `importedFrom: 'grok/<id>'`)
 * are skipped. Runs in a single Dexie transaction.
 */
export async function importGrokConversations(
  personaId: string,
  conversations: ParsedConversation[],
  options: ImportGrokOptions = {},
): Promise<ImportGrokResult> {
  const db = getClientDataDb();
  const persona = await db.personas.get(personaId);
  if (!persona) throw new Error(`importGrokConversations: persona ${personaId} not found`);

  const settings = await db.settings.get(1);
  const resolvedMindspaceId = persona.mindspaceId ?? settings?.defaultMindspaceId;
  if (!resolvedMindspaceId) {
    throw new Error('importGrokConversations: no mindspace to snapshot');
  }

  let imported = 0;
  let skipped = 0;

  await db.transaction('rw', db.chats, db.messages, async () => {
    const existing = await db.chats.where('personaId').equals(personaId).toArray();
    const seen = new Set(
      existing
        .map((c) => c.importedFrom)
        .filter((v): v is string => !!v && v.startsWith('grok/'))
        .map((v) => v.slice(5)),
    );

    for (const conv of conversations) {
      if (seen.has(conv.id)) {
        skipped++;
        continue;
      }
      seen.add(conv.id);

      const preserveBranches = options.preserveBranches ?? options.importBranchesAsSeparateChats;
      await writeChat(
        personaId,
        resolvedMindspaceId,
        conv,
        preserveBranches ? (conv.allTurns ?? conv.turns) : conv.turns,
      );

      imported++;
    }
  });

  return { imported, skipped };
}

async function writeChat(
  personaId: string,
  resolvedMindspaceId: string,
  conv: ParsedConversation,
  turns: ParsedTurn[],
): Promise<void> {
  const db = getClientDataDb();
  const chatId = uuidv7();

  await db.chats.add({
    id: chatId,
    personaId,
    title: conv.title || null,
    resolvedMindspaceId,
    createdAt: conv.createdAt,
    lastMessageAt: conv.lastMessageAt,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
    importedFrom: `grok/${conv.id}`,
  });

  const sourceToMessageId = new Map<string, string>();
  const messageParents: Array<{ id: string; parentSourceId: string | null | undefined }> = [];

  for (const turn of turns) {
    const id = uuidv7();
    await db.messages.add({
      id,
      chatId,
      role: turn.role,
      contentBlocks: turn.contentBlocks,
      createdAt: turn.createdAt,
      bookmarked: false,
      parentMessageId: null,
      streamingState: 'complete',
    });
    if (turn.sourceId) sourceToMessageId.set(turn.sourceId, id);
    messageParents.push({ id, parentSourceId: turn.parentSourceId });
  }

  for (const { id, parentSourceId } of messageParents) {
    if (!parentSourceId) continue;
    const parentMessageId = sourceToMessageId.get(parentSourceId);
    if (parentMessageId) await db.messages.update(id, { parentMessageId });
  }
}
