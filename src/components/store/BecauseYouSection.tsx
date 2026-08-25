import { useT } from '../../lib/i18n';
import type { BecauseYouCardModel } from '../../types/becauseYou';
import type { SamCategory } from '../../types/sam';
import { BecauseYouCard } from './BecauseYouCard';

interface Props {
  cards: BecauseYouCardModel[];
  category: SamCategory;
}

export function BecauseYouSection({ cards, category }: Props) {
  const { t } = useT();
  if (cards.length === 0) return null;

  const label = t('store.home.section.becauseYou');

  return (
    <section className="because-you" aria-label={label}>
      <h2 className="because-you-title">{label}</h2>
      <div className="because-you-list">
        {cards.map((c) => (
          <BecauseYouCard
            key={`${c.reason.kind}:${c.game.threadId}`}
            card={c}
            category={category}
          />
        ))}
      </div>
    </section>
  );
}
