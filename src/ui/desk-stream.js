/** When the computer column is not on screen, stop RFB. Keep the SSH tunnel. */

export const DESK_PAUSE = "openbot-desk-pause";
export const DESK_RESUME = "openbot-desk-resume";

export function shouldStreamDesktop(input = {}) {
  if (input.visibilityState === "hidden") return false;
  if (input.deskHidden) return false;
  if (!input.hasSrc) return false;
  if (input.columnDisplay === "none" || input.columnVisibility === "hidden") return false;
  const width = Number(input.columnWidth) || 0;
  const height = Number(input.columnHeight) || 0;
  if (width < 8 || height < 8) return false;
  return true;
}

export function deskStreamType(live) {
  return live ? DESK_RESUME : DESK_PAUSE;
}

export function shouldReconnectRfb(input = {}) {
  if (input.paused) return false;
  if (input.generation !== input.eventGeneration) return false;
  return true;
}
