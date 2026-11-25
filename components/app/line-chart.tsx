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
      [
        pad + i * stepX,
        pad + (1 - (v - min) / span) * (height - pad * 2),
      ] as const,
  );
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
        aria-label="Progression chart"
        preserveAspectRatio="none"
      >
        {/* faint guide lines at top / middle / bottom (hairline token) */}
        {[pad, height / 2, height - pad].map((y) => (
          <line
            key={y}
            x1={0}
            x2={width}
            y1={y}
            y2={y}
            stroke="var(--hairline)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polygon
          points={`${coords[0][0].toFixed(1)},${height - pad} ${line} ${last[0].toFixed(1)},${height - pad}`}
          fill="var(--green-soft)"
          opacity={0.7}
        />
        <polyline
          vectorEffect="non-scaling-stroke"
          points={line}
          fill="none"
          className="stroke-green"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-green"
        style={{
          left: `${(last[0] / width) * 100}%`,
          top: `${(last[1] / height) * 100}%`,
        }}
      />
    </div>
  );
}
