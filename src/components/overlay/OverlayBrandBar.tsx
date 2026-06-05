import appIcon from '../../assets/app-icon.png';

export function OverlayBrandBar() {
  return (
    <div className="game-overlay-brand" aria-hidden>
      <img
        className="game-overlay-brand-icon"
        src={appIcon}
        alt=""
        draggable={false}
      />
    </div>
  );
}