export type RuntimeToolDefinition = Record<string, unknown>;

export interface ToolDisplayAdapter {
  kind?: "read" | "edit" | "mcp" | "generic";
  overrideExistingRenderers?: boolean;
}

export interface ToolDisplayApi {
  version: 1;
  decorateTool<T extends RuntimeToolDefinition>(tool: T, adapter?: ToolDisplayAdapter | Record<string, unknown>): T;
}

export interface DecorateToolForDisplayOptions {
  suppressDecorateErrors?: boolean;
}

export declare function getToolDisplayApi(): ToolDisplayApi | undefined;

export declare function queueToolDisplayDecoration<T extends RuntimeToolDefinition>(
  tool: T,
  adapter?: ToolDisplayAdapter | Record<string, unknown>,
): void;

export declare function decorateToolForDisplay<T extends object>(
  tool: T,
  adapter?: ToolDisplayAdapter | Record<string, unknown>,
  options?: DecorateToolForDisplayOptions,
): T;

export declare function decorateMcpToolForDisplay<T extends RuntimeToolDefinition>(tool: T): T;
