type Size = 'sm' | 'md' | 'lg';

const SIZES: Record<Size, number> = { sm: 14, md: 20, lg: 28 };

interface Props {
  size?: Size;
  className?: string;
}

/** Accent ring spinner — shared across login, overlays, and page loading. */
export function Spinner({ size = 'md', className }: Props) {
  const px = SIZES[size];
  const cls = className ? `app-spinner app-spinner--${size} ${className}` : `app-spinner app-spinner--${size}`;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      className={cls}
      role="status"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="var(--border-strong)" strokeWidth="3" fill="none" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="var(--accent)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
