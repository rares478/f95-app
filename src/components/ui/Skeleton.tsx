interface Props {
  className?: string;
  style?: React.CSSProperties;
  /** Renders a circle instead of a rounded rectangle. */
  round?: boolean;
}

/** Shimmer placeholder block. Compose into page-specific skeleton layouts. */
export function Skeleton({ className, style, round }: Props) {
  const cls = round
    ? `skeleton skeleton--round${className ? ` ${className}` : ''}`
    : `skeleton${className ? ` ${className}` : ''}`;

  return <div className={cls} style={style} aria-hidden="true" />;
}
