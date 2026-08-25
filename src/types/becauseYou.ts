import type { SamGameCard } from './sam';

export type BecauseYouReason =
  | { kind: 'play'; seedThreadId: string; seedTitle: string }
  | { kind: 'interest'; tagId: number; tagName: string };

export interface BecauseYouCardModel {
  game: SamGameCard;
  reason: BecauseYouReason;
}

export interface BecauseYouPackPayload {
  dayKey: string;
  fingerprint: string;
  cards: BecauseYouCardModel[];
}
