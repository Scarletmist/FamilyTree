// Keep a focused point in the uncovered part of a map behind a mobile sheet.
export function centerForVisiblePoint(point, zoom, bottomInset = 0) {
  const sin = Math.sin(Math.max(-85, Math.min(85, point[0])) * Math.PI / 180);
  const worldY = .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  const shiftedY = worldY + bottomInset / (2 * 256 * 2 ** zoom);
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * shiftedY))) * 180 / Math.PI, point[1]];
}
