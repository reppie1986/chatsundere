// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { importGrokConversations } from '../../src/data/grok-import.js';
import { buildBranchView } from '../../src/lib/chat-branches.js';
import { flattenAnswerText } from '../../src/lib/content-blocks.js';
import { parseGrokExport } from '../../src/lib/grok-import/parser.js';

async function seedPersona(): Promise<void> {
  const db = getClientDataDb();
  const settings = await db.settings.get(1);
  await db.personas.add({
    id: 'p1',
    name: 'Tessa',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: '',
    canonicalId: 'c',
    providerId: 'pr',
    modelId: 'm',
    mindspaceId: settings?.defaultMindspaceId ?? null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    createdAt: 1,
    updatedAt: 1,
  });
}

const GROK_BRANCH_SAMPLE = JSON.stringify({
  conversations: [
    {
      conversation: {
        id: '063c7135-501e-4997-9b71-4e645ba6d56f',
        create_time: { $date: { $numberLong: '1782738472270' } },
        modify_time: { $date: { $numberLong: '1782738591147' } },
        title: 'GothTessa Lamp Struggle with Roommate',
      },
      responses: [
        {
          response: {
            _id: 'b15fc015-c213-40fe-984d-043dceb2ff2b',
            conversation_id: '063c7135-501e-4997-9b71-4e645ba6d56f',
            message: 'Opening prompt',
            sender: 'human',
            create_time: { $date: { $numberLong: '1782738472270' } },
            parent_response_id: null,
          },
        },
        {
          response: {
            _id: '64e83875-5fee-49aa-bf9e-fed99ddec76f',
            conversation_id: '063c7135-501e-4997-9b71-4e645ba6d56f',
            message: 'First assistant response',
            sender: 'ASSISTANT',
            create_time: { $date: { $numberLong: '1782738480916' } },
            parent_response_id: 'b15fc015-c213-40fe-984d-043dceb2ff2b',
          },
        },
        {
          response: {
            _id: 'bbcc788e-67b0-4693-90f2-9f28e95236ee',
            conversation_id: '063c7135-501e-4997-9b71-4e645ba6d56f',
            message: 'Forgotten as usual',
            sender: 'human',
            create_time: { $date: { $numberLong: '1782738540154' } },
            parent_response_id: '64e83875-5fee-49aa-bf9e-fed99ddec76f',
          },
        },
        {
          response: {
            _id: '7f7d03e5-2133-4810-80e2-4462fee6931f',
            conversation_id: '063c7135-501e-4997-9b71-4e645ba6d56f',
            message: 'Older regenerated reply',
            sender: 'ASSISTANT',
            create_time: { $date: { $numberLong: '1782738545808' } },
            parent_response_id: 'bbcc788e-67b0-4693-90f2-9f28e95236ee',
          },
        },
        {
          response: {
            _id: '5db87fc2-1d6b-45a7-88e2-6d4b4d3c83d0',
            conversation_id: '063c7135-501e-4997-9b71-4e645ba6d56f',
            message: 'Selected regenerated reply',
            sender: 'ASSISTANT',
            create_time: { $date: { $numberLong: '1782738571154' } },
            parent_response_id: 'bbcc788e-67b0-4693-90f2-9f28e95236ee',
          },
        },
        {
          response: {
            _id: 'b4409132-828b-4fd8-9d42-9f7b19a07bf3',
            conversation_id: '063c7135-501e-4997-9b71-4e645ba6d56f',
            message: 'Continuing from selected reply',
            sender: 'human',
            create_time: { $date: { $numberLong: '1782738591147' } },
            parent_response_id: '5db87fc2-1d6b-45a7-88e2-6d4b4d3c83d0',
          },
        },
      ],
    },
  ],
});

describe('importGrokConversations', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    await seedPersona();
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('imports Grok regenerated replies as navigable siblings', async () => {
    const parsed = parseGrokExport(GROK_BRANCH_SAMPLE);
    await importGrokConversations('p1', parsed.conversations, { preserveBranches: true });

    const db = getClientDataDb();
    const chat = (await db.chats.where('personaId').equals('p1').toArray())[0];
    expect(chat).toBeDefined();

    const messages = await db.messages
      .where('chatId')
      .equals(chat?.id ?? '')
      .sortBy('createdAt');
    const older = messages.find(
      (m) => flattenAnswerText(m.contentBlocks) === 'Older regenerated reply',
    );
    const selected = messages.find(
      (m) => flattenAnswerText(m.contentBlocks) === 'Selected regenerated reply',
    );
    expect(older?.parentMessageId).toBeTruthy();
    expect(selected?.parentMessageId).toBe(older?.parentMessageId);

    const defaultView = buildBranchView(messages, {});
    const defaultNav = defaultView.navigationByMessageId.get(selected?.id ?? '');
    expect(defaultView.visibleMessages.map((m) => flattenAnswerText(m.contentBlocks))).toContain(
      'Continuing from selected reply',
    );
    expect(defaultNav?.index).toBe(1);
    expect(defaultNav?.count).toBe(2);
    expect(defaultNav ? `${defaultNav.index + 1}/${defaultNav.count}` : null).toBe('2/2');

    const olderView = buildBranchView(messages, {
      [older?.parentMessageId ?? '']: older?.id ?? '',
    });
    const olderNav = olderView.navigationByMessageId.get(older?.id ?? '');
    expect(olderView.visibleMessages.map((m) => flattenAnswerText(m.contentBlocks))).not.toContain(
      'Continuing from selected reply',
    );
    expect(olderNav?.index).toBe(0);
    expect(olderNav?.count).toBe(2);
    expect(olderNav ? `${olderNav.index + 1}/${olderNav.count}` : null).toBe('1/2');
  });
});
