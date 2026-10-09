import * as vscode from 'vscode';

import {
  isVisualizePanelOpen,
  markVisualizePanelStale,
  updateVisualizePanel,
} from './visualize-panel';
import { LOCALS_REFERENCE, fetchVisualize } from './visualize-request';

// Live tracking for the visualize panel.
//
// The panel can follow one variable: on every stop we re-fetch it and repaint,
// so the grid tracks execution. Only members of the top-level Locals scope can
// be re-fetched, because only they have a stable container + name; nested
// values are addressed by a reference that is invalidated at the next stop.

let pinnedName: string | undefined;

/**
 * Bumped per refresh and per pin change; a response that is not from the
 * latest refresh, or that arrives after the user picked another value, is
 * discarded.
 */
let generation = 0;

export function pinVariable(name: string): void {
  pinnedName = name;
  generation++;
}

export function unpinVariable(): void {
  pinnedName = undefined;
  generation++;
}

/** Re-read the pinned variable and repaint the visualize panel. */
export async function refreshPinnedVariable(
  session: vscode.DebugSession,
): Promise<void> {
  const name = pinnedName;
  if (!name) {
    return;
  }

  if (!isVisualizePanelOpen()) {
    return;
  }

  const mine = ++generation;
  try {
    const body = await fetchVisualize(session, {
      containerReference: LOCALS_REFERENCE,
      name,
    });
    if (mine !== generation) {
      return; // a later stop or a new pick superseded this answer
    }

    updateVisualizePanel(name, body);
  } catch {
    if (mine !== generation) {
      return;
    }

    markVisualizePanelStale(); // the variable is out of scope at this stop
  }
}
