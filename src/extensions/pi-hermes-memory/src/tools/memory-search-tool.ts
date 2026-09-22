import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { DatabaseManager } from '../store/db.js';
import { searchMemories, getMemoryStats } from '../store/sqlite-memory-store.js';
import type { MemoryCategory } from '../types.js';
import { createSharedToolResultRenderer } from './shared-output-view.js';
import { searchResultView } from './tool-result-views.js';
import {
  isMemorySearchRequest,
  MEMORY_SEARCH_REQUEST_EVENT,
  type MemorySearchRequestInput,
  type MemorySearchResponse,
} from '../memory-search-bridge.js';

function mutationTarget(entry: { target: "memory" | "user" | "failure"; project: string | null }): "memory" | "user" | "failure" | "project" {
  // A project name scopes ordinary memory entries, but project-attributed
  // failures still live in (and must be mutated through) the failure store.
  return entry.target === "memory" && entry.project ? "project" : entry.target;
}

function scopeLabel(project: string | null): string {
  return project ? `project:${encodeURIComponent(project)}` : "global";
}

/** The read-only implementation shared by the model tool and local extensions. */
export function searchMemory(dbManager: DatabaseManager, args: MemorySearchRequestInput): MemorySearchResponse {
  const query = args.query;
  const project = args.project;
  const target = args.target;
  const category = args.category as MemoryCategory | undefined;
  const limit = Math.min(args.limit || 10, 20);

  if (!query || query.trim().length === 0) {
    return { success: false, message: 'query is required' };
  }

  const stats = getMemoryStats(dbManager);
  if (stats.total === 0) {
    return { success: false, message: 'No memories in extended store yet. Use memory_add to store memories.' };
  }

  const results = searchMemories(dbManager, query, { project, target, category, limit });

  if (results.length === 0) {
    return { success: true, count: 0, message: `No memories found matching "${query}". Try a different search term or broader query.` };
  }

  let output = `Found ${results.length} memories matching "${query}":\n\n`;

  for (const entry of results) {
    const resultTarget = mutationTarget(entry);
    const projectLabel = `scope=${scopeLabel(entry.project)}`;
    const mutationTargetLabel = `[target=${resultTarget}]`;
    const targetLabel = entry.target === 'user' ? '👤' : entry.target === 'failure' ? '⚠️' : '🧠';
    const categoryLabel = entry.category ? ` [${entry.category}]` : '';
    output += `${targetLabel} ${projectLabel} ${mutationTargetLabel}${categoryLabel} ${entry.content}\n`;
    output += `   Created: ${entry.created} | Last used: ${entry.lastReferenced}\n\n`;
  }

  return { success: true, count: results.length, output: output.trim() };
}

export function registerMemorySearchTool(pi: ExtensionAPI, dbManager: DatabaseManager): void {
  pi.events?.on(MEMORY_SEARCH_REQUEST_EVENT, (request: unknown) => {
    if (!isMemorySearchRequest(request)) return;
    request.respond(searchMemory(dbManager, request.input));
  });

  pi.registerTool({
    name: 'memory_search',
    label: 'Memory Search',
    description: `Search extended memory store for relevant entries. Use this when you need context beyond what's in the system prompt — the extended store has unlimited capacity and is searchable.

Use cases:
- Find memories about a specific topic: "What do I know about auth setup?"
- Search project-specific memories: "What conventions does project X follow?"
- Find user preferences: "What are the user's testing preferences?"
- Search for past failures: "memory_search('auth', category='failure')"

target="project" returns only project-attributed memory entries (the ones labeled [target=project]); combine with project to search a named project.

Returns matching memory entries with their mutation target, scope, and dates. The displayed target is the value required by memory_replace and memory_remove.`,
    promptSnippet: 'Search extended memory store (unlimited capacity)',
    ...{ discovery: {
      summary: 'Search the extended durable memory store for relevant entries',
      aliases: ['memory lookup', 'search memories', 'recall memory'],
      category: 'memory',
    } },
    promptGuidelines: [
      'Use memory_search when you need context beyond what is in the system prompt.',
      'Use memory_search to find project-specific memories or user preferences.',
      'Use memory_search with category filter to find specific types of memories (failure, correction, insight, etc.).',
    ],
    renderResult: createSharedToolResultRenderer(searchResultView),
    parameters: Type.Object({
      query: Type.String({ description: 'Search query. Use natural language or specific terms.' }),
      project: Type.Optional(Type.String({ description: 'Filter by project name. Pass null for global memories only.' })),
      target: Type.Optional(StringEnum(['memory', 'user', 'failure', 'project'] as const, { description: 'Filter by target type: memory, user, failure, or project-attributed memories.' })),
      category: Type.Optional(StringEnum(['failure', 'correction', 'insight', 'preference', 'convention', 'tool-quirk'] as const, { description: 'Filter by memory category.' })),
      limit: Type.Optional(Type.Number({ description: 'Maximum results to return (default: 10, max: 20).' })),
    }),
    execute: async (_id: string, args: { query: string; project?: string; target?: 'memory' | 'user' | 'failure' | 'project'; category?: MemorySearchRequestInput['category']; limit?: number }) => {
      const result = searchMemory(dbManager, args);
      return { content: [{ type: 'text' as const, text: result.output ?? result.message ?? '' }], details: result };
    },
  });
}
