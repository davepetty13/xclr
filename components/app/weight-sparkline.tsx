// Pure SVG sparkline for the weight trend. Colors come from tokens via Tailwind
// stroke/fill classes (stroke-green → var(--green)); no hardcoded values.
export function WeightSparkline({
  points,
  width = 240,
  height = 48,
}: {
  points: number[]; // oldest → newest
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 4;
  const stepX = (width - pad * 2) / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (p - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = coords
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const last = coords[coords.length - 1];

  // The SVG stretches to its box (preserveAspectRatio="none"), so the end dot is
  // an HTML element positioned in % — it stays round at any width.
  return (
    <div className="relative" style={{ height }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Weight trend"
        preserveAspectRatio="none"
      >
        <polyline
          vectorEffect="non-scaling-stroke"
          points={line}
          fill="none"
          className="stroke-green"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green"
        style={{
          left: `${(last[0] / width) * 100}%`,
          top: `${(last[1] / height) * 100}%`,
        }}
      />
    </div>
  );
}
