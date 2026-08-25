import { Link } from 'react-router-dom';
import { memberProfilePath } from '../lib/memberProfilePath';

/**
 * Shared avatar + name chip. When userId resolves to a member path, renders a Link.
 * Invalid HTML: never nest UserChip (Link) inside a <button> — restructure parents instead.
 */
export function UserChip({
  userId,
  username,
  avatarUrl,
  className = '',
  showName = true,
  size = 40,
  onNavigate,
}: {
  userId: string | null | undefined;
  username: string;
  avatarUrl: string | null | undefined;
  className?: string;
  showName?: boolean;
  size?: number;
  /** Optional; e.g. close notification panel on navigate (Task 8). */
  onNavigate?: () => void;
}) {
  const to = memberProfilePath(userId);
  const letter = (username.trim()[0] ?? '?').toUpperCase();
  const inner = (
    <>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="user-chip-avatar"
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span
          className="user-chip-avatar user-chip-avatar--fallback"
          style={{ width: size, height: size }}
          aria-hidden
        >
          {letter}
        </span>
      )}
      {showName ? <span className="user-chip-name">{username}</span> : null}
    </>
  );

  if (!to) {
    return <span className={`user-chip user-chip--inert ${className}`.trim()}>{inner}</span>;
  }

  return (
    <Link
      to={to}
      className={`user-chip user-chip--link ${className}`.trim()}
      aria-label={username}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate?.();
      }}
    >
      {inner}
    </Link>
  );
}
