// SPDX-License-Identifier: AGPL-3.0-only

import type { ContentBlock } from '../../boot/client-data-db.js';
import type {
  GrokExport,
  GrokResponse,
  GrokResponseEnvelope,
  GrokTimestamp,
  ParsedConversation,
  ParsedGrokExport,
  ParsedTurn,
} from './types.js';

const GROK_SENDER_USER = new Set(['human']);
const GROK_SENDER_PERSONA = new Set(['ASSISTANT', 'assistant', 'grok-4', 'grok-4-auto']);

function mapSender(sender: string): 'user' | 'persona' {
  if (GROK_SENDER_USER.has(sender)) return 'user';
  return 'persona';
}

/**
 * Parse and validate a Grok export JSON string.
 * Throws on invalid format (missing `conversations` array).
 */
export function parseGrokExport(jsonString: string): ParsedGrokExport {
  let raw: GrokExport;
  try {
    raw = JSON.parse(jsonString) as GrokExport;
  } catch {
    throw new Error('Could not parse the file as JSON. Make sure it is a valid Grok export.');
  }

  if (!Array.isArray(raw.conversations)) {
    throw new Error(
      'This does not look like a Grok export — expected a "conversations" array at the top level.',
    );
  }

  const conversations: ParsedConversation[] = [];

  for (const conv of raw.conversations) {
    const meta = conv.conversation;
    const { responses } = conv;

    if (!Array.isArray(responses) || responses.length === 0) continue;

    const result = lineariseConversation(responses);
    if (result.turns.length === 0) continue;

    conversations.push({
      id: meta.id,
      title: meta.title || 'Untitled',
      createdAt: parseTimestamp(meta.create_time),
      lastMessageAt: parseTimestamp(meta.modify_time),
      turnCount: result.turns.length,
      branchCount: result.branches.length,
      turns: result.turns,
      allTurns: result.allTurns,
    });
  }

  return { conversations };
}

export function parseTimestamp(s: GrokTimestamp, fallback?: number): number {
  if (!s) return fallback ?? Date.now();
  const raw =
    typeof s === 'string' ? s : typeof s.$date === 'string' ? s.$date : s.$date?.$numberLong;
  if (typeof raw === 'number') return raw;
  if (!raw) return fallback ?? Date.now();
  const v = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(v) ? v : (fallback ?? Date.now());
}

// ── Tree linearisation ────────────────────────────────────────────────────

interface LinearisedResult {
  turns: ParsedTurn[];
  branches: ParsedTurn[][];
  allTurns: ParsedTurn[];
}

/**
 * Linearise a Grok conversation's response tree into a primary turn sequence
 * and alternative branches.
 *
 * Strategy:
 * 1. Keep ALL responses in the tree (including partials) so children of
 *    partial responses remain reachable — partials are skipped when building
 *    the turn sequence, not removed from the tree structure.
 * 2. Build parent→children adjacency from all responses.
 * 3. DFS from root; at each branch pick the child with the deepest/latest
 *    subtree as the primary path; collect all other subtrees as branches.
 */
export function lineariseConversation(envelopes: GrokResponseEnvelope[]): LinearisedResult {
  const all = envelopes.map((e) => e.response);

  if (all.length === 0) return { turns: [], branches: [], allTurns: [] };

  // Build adjacency from ALL responses — partials stay in the tree
  // so their children remain reachable.
  const childrenOf = new Map<string, GrokResponse[]>();
  const byId = new Map<string, GrokResponse>();
  const roots: GrokResponse[] = [];

  for (const r of all) {
    byId.set(r._id, r);
    const parentId = r.parent_response_id;
    if (!parentId) {
      roots.push(r);
    } else {
      const list = childrenOf.get(parentId) ?? [];
      list.push(r);
      childrenOf.set(parentId, list);
    }
  }

  if (roots.length === 0) return { turns: [], branches: [], allTurns: [] };

  // Use first root as primary (in well-formed exports there is exactly one)
  const primaryRoot = roots[0] as GrokResponse;
  const result: LinearisedResult = {
    turns: [],
    branches: [],
    allTurns: [],
  };

  for (const response of all) {
    if (response.partial === true) continue;
    const turn = responseToTurn(response, visibleParentSourceId(response));
    if (turn) result.allTurns.push(turn);
  }

  // DFS helper: get latest create_time in a subtree
  function subtreeLatestTime(node: GrokResponse): number {
    let latest = parseTimestamp(node.create_time);
    const kids = childrenOf.get(node._id);
    if (kids) {
      for (const kid of kids) {
        const kidTime = subtreeLatestTime(kid);
        if (kidTime > latest) latest = kidTime;
      }
    }
    return latest;
  }

  // Walk primary branch, collecting alternatives.
  // Partial responses are kept in the tree for navigability but skipped as turns.
  function walkPrimary(node: GrokResponse): void {
    if (node.partial !== true) {
      const turn = responseToTurn(node, visibleParentSourceId(node));
      if (turn) result.turns.push(turn);
    }

    const kids = childrenOf.get(node._id);
    if (!kids || kids.length === 0) return;

    // Find child with the latest subtree (primary continuation)
    let best = kids[0] as GrokResponse;
    let bestTime = -1;
    for (const kid of kids) {
      const t = subtreeLatestTime(kid);
      if (t > bestTime) {
        bestTime = t;
        best = kid;
      }
    }

    // Collect alternative branches (skip partial alternatives)
    for (const kid of kids) {
      if (kid === best) continue;
      const branch: ParsedTurn[] = [];
      collectSubtree(kid, branch);
      if (branch.length > 0) result.branches.push(branch);
    }

    // Continue primary path
    walkPrimary(best);
  }

  function collectSubtree(node: GrokResponse, out: ParsedTurn[]): void {
    if (node.partial !== true) {
      const turn = responseToTurn(node, visibleParentSourceId(node));
      if (turn) out.push(turn);
    }
    const kids = childrenOf.get(node._id);
    if (kids) {
      for (const kid of kids) {
        if (kid) collectSubtree(kid, out);
      }
    }
  }

  walkPrimary(primaryRoot);

  return result;

  function visibleParentSourceId(node: GrokResponse): string | null {
    let parentId = node.parent_response_id;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) return parentId;
      if (parent.partial !== true) return parent._id;
      parentId = parent.parent_response_id;
    }
    return null;
  }
}

// ── Response → Turn ────────────────────────────────────────────────────────

function responseToTurn(r: GrokResponse, parentSourceId: string | null): ParsedTurn | null {
  const blocks = extractContentBlocks(r);
  if (blocks.length === 0) return null;

  return {
    sourceId: r._id,
    parentSourceId,
    role: mapSender(r.sender),
    contentBlocks: blocks,
    createdAt: parseTimestamp(r.create_time),
  };
}

/**
 * Extract ContentBlocks from a Grok response.
 * v1: text + reasoning (thinking traces). Attachments are skipped.
 */
export function extractContentBlocks(r: GrokResponse): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // Message text
  const text = r.message?.trim();
  if (text) blocks.push({ type: 'text', text });

  // Thinking traces → reasoning block
  const thinkingText = extractThinkingText(r);
  if (thinkingText) blocks.push({ type: 'reasoning', text: thinkingText });

  return blocks;
}

function extractThinkingText(r: GrokResponse): string | null {
  // agent_thinking_traces is the primary: array of { agent_id, thinking_trace }
  if (Array.isArray(r.agent_thinking_traces) && r.agent_thinking_traces.length > 0) {
    const parts: string[] = [];
    for (const t of r.agent_thinking_traces) {
      const trace = t.thinking_trace?.trim();
      if (trace) parts.push(trace);
    }
    if (parts.length > 0) return parts.join('\n');
  }

  // Fallback: thinking_trace string
  const trace = r.thinking_trace?.trim();
  if (trace) return trace;

  return null;
}
