/**
 * Contracts shared by the editor (apps/web) and the local MCP bridge (apps/mcp-bridge):
 * the bridge wire protocol, the assistant's tool catalogue (executed in the tab against the
 * single ProjectEngine), privacy-filtered views, and edit planning shared with the UI.
 */
export * from './protocol.ts';
export * from './tools.ts';
export * from './views.ts';
export * from './planning.ts';
