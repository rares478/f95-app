interface Props {
  hotkey: string;
}

export function OverlayHotkeyBadge({ hotkey }: Props) {
  const parts = hotkey.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  return (
    <span className="game-overlay-hotkey-badge" aria-label={hotkey}>
      {parts.map((part, i) => (
        <span key={`${part}-${i}`}>
          {i > 0 && <span className="game-overlay-hotkey-sep">+</span>}
          <kbd className="game-overlay-kbd">{part}</kbd>
        </span>
      ))}
    </span>
  );
}
