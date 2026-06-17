/**
 * Returns the collapsed-process set for a fully expanded or fully collapsed graph state.
 */
export function getCollapsedProcessIdsForExpandedState(
  validRankIds: ReadonlySet<string>,
  expanded: boolean
): Set<string> {
  return expanded ? new Set<string>() : new Set(validRankIds);
}

/**
 * Returns whether the bulk toggle command should expand all processes.
 */
export function shouldToggleAllProcessesToExpanded(
  collapsedProcessIds: ReadonlySet<string>
): boolean {
  return collapsedProcessIds.size > 0;
}

/**
 * Returns the collapsed-process set after applying the bulk toggle behavior.
 */
export function getCollapsedProcessIdsForBulkToggle(
  validRankIds: ReadonlySet<string>,
  collapsedProcessIds: ReadonlySet<string>
): Set<string> {
  return getCollapsedProcessIdsForExpandedState(
    validRankIds,
    shouldToggleAllProcessesToExpanded(collapsedProcessIds)
  );
}
