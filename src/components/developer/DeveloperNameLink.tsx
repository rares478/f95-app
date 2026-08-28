import { useNavigate } from 'react-router-dom';
import { developerProfilePath } from '../../lib/developerProfilePath';

type Props = {
  name: string;
  className?: string;
  stopPropagation?: boolean;
};

export function DeveloperNameLink({
  name,
  className,
  stopPropagation = false,
}: Props) {
  const navigate = useNavigate();
  const trimmed = name.trim();
  if (!trimmed) return null;

  return (
    <button
      type="button"
      className={className ?? 'developer-name-link'}
      onClick={(e) => {
        if (stopPropagation) {
          e.preventDefault();
          e.stopPropagation();
        }
        navigate(developerProfilePath(trimmed));
      }}
    >
      {trimmed}
    </button>
  );
}
