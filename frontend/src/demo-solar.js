// A deterministic demo curve, tied to the same sun elevation as the renderer.
export function demoSolarPower(elevation, peakKw = 5.4) {
  if (!Number.isFinite(elevation) || elevation <= 0) return 0;
  return Math.round(peakKw * Math.sin(Math.min(90, elevation) * Math.PI / 180) * 100) / 100;
}
