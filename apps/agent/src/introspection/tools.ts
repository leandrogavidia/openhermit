import { createMemoryAddTool, createMemoryDeleteTool, createMemoryGetTool, createMemoryRecallTool, createMemoryUpdateTool } from '../tools/memory.js';
import { createSessionDescriptionUpdateTool } from '../tools/session-description.js';
import { createWorkingMemoryUpdateTool } from '../tools/working-memory.js';
import type { PolicyAwareTool, ToolContext } from '../tools/shared.js';

/**
 * Creates the tool set available to the introspection agent.
 * Memory tools, working memory, and session description — no exec, container, web, or instruction tools.
 * No approval wrapping — introspection is an internal process.
 */
export const createIntrospectionTools = (
  context: ToolContext,
): PolicyAwareTool[] => {
  const tools: PolicyAwareTool[] = [];

  if (context.memoryProvider) {
    tools.push(
      createMemoryGetTool(context),
      createMemoryRecallTool(context),
      createMemoryAddTool(context),
      createMemoryUpdateTool(context),
      createMemoryDeleteTool(context),
    );
  }

  if (context.messageStore && context.storeScope && context.sessionId) {
    tools.push(createWorkingMemoryUpdateTool(context));
  }

  if (context.sessionStore && context.storeScope && context.sessionId) {
    tools.push(createSessionDescriptionUpdateTool(context));
  }

  return tools;
};
