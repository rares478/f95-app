interface Props {
  images: string[];
  slide: number;
}

export function StoreCardThumbDots({ images, slide }: Props) {
  if (images.length <= 1) return null;
  return (
    <div className="store-card-thumb-dots" aria-hidden>
      {images.map((src, i) => (
        <span
          key={src}
          className={`store-card-thumb-dot${i === slide ? ' is-active' : ''}`}
        />
      ))}
    </div>
  );
}
