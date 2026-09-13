/**
 * Shared terminal-width breakpoints for the working conversation. Keep the
 * sidebar out of a narrow transcript rather than allowing it to crush the
 * composer or silently clip activity details.
 */
export function resolveWorkspaceLayout(
  width: number,
  hasMessages: boolean,
): {
  sidebarWidth: number;
  showSidebar: boolean;
  chatWidth: number;
} {
  const sidebarWidth = width >= 150 ? 38 : 34;
  const showSidebar = hasMessages && width >= 118;
  return {
    sidebarWidth,
    showSidebar,
    chatWidth: showSidebar ? Math.max(72, width - sidebarWidth) : width,
  };
}
