import { Spinner } from './Spinner';

interface Props {
  label?: string;
  /** `page` = tall centered block; `inline` = compact row; `compact` = small column. */
  variant?: 'page' | 'inline' | 'compact';
  className?: string;
}

/** Spinner + optional label for bootstrap, empty states, and pagination. */
export function LoadingState({ label, variant = 'page', className }: Props) {
  const cls = className
    ? `loading-state loading-state--${variant} ${className}`
    : `loading-state loading-state--${variant}`;

  const spinnerSize = variant === 'inline' ? 'sm' : 'md';

  return (
    <div className={cls} role="status" aria-live="polite" aria-busy="true">
      <Spinner size={spinnerSize} />
      {label && <span className="loading-state-label">{label}</span>}
    </div>
  );
}
