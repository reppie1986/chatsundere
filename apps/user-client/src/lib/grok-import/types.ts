// SPDX-License-Identifier: AGPL-3.0-only

import type { ContentBlock } from '../../boot/client-data-db.js';

// ── Wire-format: Grok export JSON ──────────────────────────────────────────

export interface GrokExport {
  conversations: GrokConversation[];
  projects: GrokProject[];
  tasks: unknown[];
  media_posts: unknown[];
}

export interface GrokConversation {
  conversation: GrokConversationMeta;
  responses: GrokResponseEnvelope[];
}

export interface GrokConversationMeta {
  id: string;
  user_id: string;
  anon_user_id: string | null;
  create_time: GrokTimestamp;
  modify_time: GrokTimestamp;
  system_prompt_id: string | null;
  temporary: boolean;
  leaf_response_id: string | null;
  title: string;
  summary: string;
  asset_ids: string[];
  root_asset_id: string | null;
  x_user_id: string | null;
  starred: boolean;
  system_prompt_name: string;
  media_types: string[];
  controller: string | null;
  task_result_id: string | null;
  team_id: string | null;
  shared_with_team: boolean | null;
  shared_with_user_ids: string[];
}

export interface GrokResponseEnvelope {
  response: GrokResponse;
}

export interface GrokResponse {
  _id: string;
  conversation_id: string;
  message: string;
  sender: string;
  create_time: GrokTimestamp;
  parent_response_id: string | null;
  agent_thinking_traces?: GrokThinkingTrace[] | null;
  thinking_trace?: string | null;
  partial?: boolean | null;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
  web_search_results?: unknown | null;
  card_attachments_json?: unknown | null;
  file_attachments?: unknown | null;
  generated_image_urls?: string[] | null;
  query?: string | null;
  query_type?: string | null;
  xpost_ids?: string[] | null;
  media_types?: string[] | null;
}

export type GrokTimestamp =
  | string
  | { $date?: string | { $numberLong?: string | number } }
  | undefined
  | null;

export interface GrokThinkingTrace {
  agent_id: { rollout_id: string };
  thinking_trace: string;
}

export interface GrokProject {
  workspace_id?: string;
  user_id?: string;
  anon_user_id?: string | null;
  create_time?: string;
  last_use_time?: string;
  name: string;
  icon?: string;
  custom_personality?: string;
  preferred_model?: string;
  conversation_starters?: string[];
  is_public?: boolean;
  kind?: string;
}

// ── Parsed: internal representation after linearisation ────────────────────

export interface ParsedTurn {
  sourceId?: string;
  parentSourceId?: string | null;
  role: 'user' | 'persona';
  contentBlocks: ContentBlock[];
  createdAt: number;
}

export interface ParsedConversation {
  id: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;
  turnCount: number;
  branchCount: number;
  turns: ParsedTurn[];
  allTurns?: ParsedTurn[];
}

export interface ParsedGrokExport {
  conversations: ParsedConversation[];
}
