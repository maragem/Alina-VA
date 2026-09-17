import { JSX } from "react/jsx-runtime";

type EuFlagProps = {
  className?: string;
  title?: string;
};

const STAR_POSITIONS: { x: number; y: number }[] = (() => {
  const cx = 30;
  const cy = 20;
  const r = 40 / 3;
  const positions: { x: number; y: number }[] = [];

  for (let i = 0; i < 12; i++) {
    const angle = Math.PI / 2 - (i * 2 * Math.PI) / 12;
    positions.push({
      x: cx + r * Math.cos(angle),
      y: cy - r * Math.sin(angle),
    });
  }

  return positions;
})();

function Star({
  cx,
  cy,
  size,
}: {
  cx: number;
  cy: number;
  size: number;
}): JSX.Element {
  const outer = size;
  const inner = size * 0.382;
  const points: string[] = [];

  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = Math.PI / 2 - (i * Math.PI) / 5;
    points.push(
      `${cx + radius * Math.cos(angle)},${cy - radius * Math.sin(angle)}`,
    );
  }

  return <polygon points={points.join(" ")} fill="#FFCC00" />;
}

export function EuFlag({
  className,
  title = "Flag of the European Union",
}: EuFlagProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 60 40"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <rect width="60" height="40" fill="#003399" />
      {STAR_POSITIONS.map((position, index) => (
        <Star key={index} cx={position.x} cy={position.y} size={40 / 18} />
      ))}
    </svg>
  );
}
