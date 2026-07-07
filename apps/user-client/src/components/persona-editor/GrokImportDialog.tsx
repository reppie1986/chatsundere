// SPDX-License-Identifier: AGPL-3.0-only

import { useQueryClient } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { importGrokConversations } from '../../data/grok-import.js';
import { usePersonas } from '../../data/personas.js';
import { QK } from '../../data/queryKeys.js';
import { parseGrokExport } from '../../lib/grok-import/parser.js';
import type { ParsedConversation, ParsedGrokExport } from '../../lib/grok-import/types.js';
import { toastStore } from '../../state/toast.store.js';
import { Button } from '../ui/Button.js';

const PER_PAGE = 20;
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const MOBILE_MAX_FILE_SIZE_BYTES = 40 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function isMobileLikeBrowser(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  return window.matchMedia?.('(pointer: coarse)').matches === true && window.innerWidth <= 900;
}

export function GrokImportDialog({
  open,
  onClose,
  personaId: preselectedPersonaId,
}: {
  open: boolean;
  onClose: () => void;
  personaId: string | null;
}): JSX.Element | null {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { data: personas } = usePersonas();

  // Parse state
  const [parsed, setParsed] = useState<ParsedGrokExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);

  // Options
  const [targetPersonaId, setTargetPersonaId] = useState<string>(preselectedPersonaId ?? '');
  const [importBranches, setImportBranches] = useState(false);

  // Reset state when dialog opens
  if (open && !parsed && !error && !loading) {
    // Ensure file input is clean
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── File handling ─────────────────────────────────────────────────────

  async function onPickFile(file: File): Promise<void> {
    setError(null);
    setParsed(null);
    setSelectedIds(new Set());
    setSearchQuery('');
    setPage(0);

    if (isMobileLikeBrowser() && file.size > MOBILE_MAX_FILE_SIZE_BYTES) {
      setError(
        `File is ${formatFileSize(file.size)}; mobile browsers can reload the app while parsing large Grok exports. Use desktop for this export.`,
      );
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(
        `File is ${(file.size / 1024 / 1024).toFixed(0)} MB — the maximum supported size is 500 MB.`,
      );
      return;
    }

    setLoading(true);
    try {
      const text = await file.text();
      const result = parseGrokExport(text);
      if (result.conversations.length === 0) {
        setError('No importable conversations found in this export.');
      } else {
        setParsed(result);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // ── Selection logic ───────────────────────────────────────────────────

  const filtered = parsed
    ? searchQuery.trim()
      ? parsed.conversations.filter((c) =>
          c.title.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : parsed.conversations
    : [];

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageConvs = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  function toggleAll(): void {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((c) => c.id)));
    }
  }

  function toggleOne(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Import ────────────────────────────────────────────────────────────

  const selectedConvs = parsed ? parsed.conversations.filter((c) => selectedIds.has(c.id)) : [];
  const allSelected = !!(parsed && selectedIds.size === filtered.length && filtered.length > 0);

  async function onImport(): Promise<void> {
    if (!targetPersonaId || selectedConvs.length === 0) return;

    setLoading(true);
    try {
      const result = await importGrokConversations(targetPersonaId, selectedConvs, {
        preserveBranches: importBranches,
      });

      toastStore.show({
        message:
          result.imported > 0
            ? `Imported ${result.imported} ${result.imported === 1 ? 'conversation' : 'conversations'}${
                result.skipped > 0 ? ` (${result.skipped} already imported)` : ''
              }.`
            : 'No new conversations to import.',
        tone: result.imported > 0 ? 'success' : 'info',
        durationMs: 3500,
      });

      await qc.invalidateQueries({ queryKey: QK.chats });
      onClose();
    } catch (e) {
      toastStore.show({ message: (e as Error).message, tone: 'warn', durationMs: 3500 });
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (!open) return null;

  const showPersonaPicker = !preselectedPersonaId;

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives CSS animation; <dialog> requires showModal() which conflicts with our zoom entry
    <div className="cs-dialog-root" role="dialog" aria-modal="true" aria-label="Import from Grok">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to cancel; Escape is handled on document */}
      <div className="cs-dialog-backdrop" onClick={onClose} />

      <div className="cs-dialog-card cs-zoom-in flex max-h-[80vh] w-[520px] max-w-[90vw] flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <h2 className="text-base font-semibold text-paper">Import from Grok</h2>
          <button type="button" onClick={onClose} className="text-paper-soft hover:text-paper">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-5">
          {/* File picker (shown when nothing parsed yet) */}
          {!parsed && !loading ? (
            <>
              <p className="text-[11px] text-paper-soft">
                Pick a Grok data export (<code>.json</code>) to import conversations from.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickFile(f);
                  e.target.value = '';
                }}
              />
              <Button tone="primary" priority onClick={() => fileInputRef.current?.click()}>
                Choose export file
              </Button>
            </>
          ) : null}

          {/* Loading */}
          {loading ? (
            <p className="py-8 text-center text-xs text-paper-soft">Parsing export file…</p>
          ) : null}

          {/* Error */}
          {error ? (
            <div className="rounded-md border border-amber-300/30 bg-amber-300/5 p-3">
              <p className="text-[11px] text-amber-300/80">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setParsed(null);
                }}
                className="mt-2 text-[11px] text-paper-soft underline hover:text-paper"
              >
                Try a different file
              </button>
            </div>
          ) : null}

          {/* Parsed: conversation picker */}
          {parsed && !loading ? (
            <>
              <p className="text-[11px] text-paper-soft">
                Found {parsed.conversations.length} conversations in the export.
                {parsed.conversations.length !== filtered.length
                  ? ` Showing ${filtered.length} matching "${searchQuery}".`
                  : ''}
              </p>

              {/* Search */}
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-paper-soft"
                />
                <input
                  type="text"
                  placeholder="Search conversations…"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(0);
                  }}
                  className="w-full rounded-md border border-white/10 bg-white/[0.03] py-1.5 pl-8 pr-3 text-xs text-paper placeholder-paper-soft/50 outline-none focus:border-white/20"
                />
              </div>

              {/* Select all */}
              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-paper-soft">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-paper"
                  />
                  {allSelected ? 'Deselect all' : `Select all (${filtered.length})`}
                </label>
                <span className="text-[11px] text-paper-soft">{selectedIds.size} selected</span>
              </div>

              {/* Conversation list */}
              <div className="flex flex-col gap-1">
                {pageConvs.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-paper-soft">
                    No conversations match your search.
                  </p>
                ) : (
                  pageConvs.map((conv) => {
                    const checked = selectedIds.has(conv.id);
                    return (
                      <label
                        key={conv.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-white/[0.03]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(conv.id)}
                          className="accent-paper shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs text-paper">
                            {conv.title || 'Untitled'}
                          </div>
                          <div className="text-[10px] text-paper-soft">
                            {conv.turnCount} messages
                            {conv.branchCount > 0 ? ` · ${conv.branchCount} branches` : ''}
                            {' · '}
                            {new Date(conv.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 ? (
                <div className="flex items-center justify-center gap-2 text-[11px] text-paper-soft">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="disabled:opacity-30 hover:text-paper"
                  >
                    Previous
                  </button>
                  <span>
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    className="disabled:opacity-30 hover:text-paper"
                  >
                    Next
                  </button>
                </div>
              ) : null}

              {/* Persona picker */}
              {showPersonaPicker ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="grok-target-persona" className="text-[11px] text-paper-soft">
                    Import into persona
                  </label>
                  <select
                    id="grok-target-persona"
                    value={targetPersonaId}
                    onChange={(e) => setTargetPersonaId(e.target.value)}
                    className="w-full rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-paper outline-none focus:border-white/20"
                  >
                    <option value="" disabled>
                      Select a persona…
                    </option>
                    {personas?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || 'Unnamed'}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {/* Branch option */}
              <fieldset className="flex flex-col gap-1.5 border-0 p-0">
                <legend className="text-[11px] text-paper-soft">Branch handling</legend>
                <label className="flex cursor-pointer items-start gap-2 text-[11px] text-paper-soft">
                  <input
                    type="radio"
                    name="branches"
                    checked={!importBranches}
                    onChange={() => setImportBranches(false)}
                    className="accent-paper mt-0.5 shrink-0"
                  />
                  <span>
                    Flatten to latest branch (recommended) — discards old regenerated responses
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-[11px] text-paper-soft">
                  <input
                    type="radio"
                    name="branches"
                    checked={importBranches}
                    onChange={() => setImportBranches(true)}
                    className="accent-paper mt-0.5 shrink-0"
                  />
                  <span>
                    Import all branches into one chat — regenerated replies become navigable
                    alternatives
                  </span>
                </label>
              </fieldset>

              {/* Action */}
              <div className="flex gap-2 pt-1">
                <Button tone="neutral" priority={false} onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  tone="primary"
                  priority
                  disabled={!targetPersonaId || selectedConvs.length === 0 || loading}
                  onClick={onImport}
                >
                  Import {selectedConvs.length > 0 ? `${selectedConvs.length} ` : ''}
                  {selectedConvs.length === 1 ? 'conversation' : 'conversations'}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
