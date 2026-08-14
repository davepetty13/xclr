// Pure SVG line chart for per-exercise progression. Tokens only (stroke/fill).
export function LineChart({
  values,
  height = 120,
}: {
  values: number[];
  height?: number;
}) {
  if (values.length < 2)
    return (
      <p className="text-sm font-medium text-muted">
        Log a few more sessions to see the trend.
      </p>
    );
  const width = 320;
  const pad = 8;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (width - pad * 2) / (values.length - 1);
  const coords = values.map(
    (v, i) =>
      [pad + i * stepX, pad + (1 - (v - min) / span) * (height - pad * 2)] as const
  );
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Progression chart"
      preserveAspectRatio="none"
    >
      <polyline
        points={line}
        fill="none"
        className="stroke-green"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={3.5} className="fill-green" />
    </svg>
  );
}
