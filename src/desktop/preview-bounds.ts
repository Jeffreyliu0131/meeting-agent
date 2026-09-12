/** DIP bounds shared by macOS and Windows; keep the launcher outside the preview. */
export type Rectangle = { x: number; y: number; width: number; height: number };
export function previewBounds(
  launcher: Rectangle,
  area: Rectangle,
  hasMeeting: boolean,
): Rectangle {
  const gap = 8;
  const margin = 8;
  const desiredWidth = hasMeeting ? 760 : 340;
  const leftSpace = Math.max(1, launcher.x - area.x - gap - margin);
  const rightSpace = Math.max(1, area.x + area.width - margin - launcher.x - launcher.width - gap);
  const left = leftSpace >= desiredWidth || leftSpace >= rightSpace;
  const width = Math.min(desiredWidth, left ? leftSpace : rightSpace);
  const height = Math.max(1, Math.min(hasMeeting ? 560 : 240, area.height - margin * 2));
  const x = left ? launcher.x - gap - width : launcher.x + launcher.width + gap;
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(
      Math.max(area.y + margin, Math.min(launcher.y - 12, area.y + area.height - height - margin)),
    ),
    width: Math.round(width),
    height: Math.round(height),
  };
}
