export interface AchievementDefinition {
  id: string;
  threadId: string | null;
  title: string;
  description: string | null;
  iconKey: string | null;
  points: number;
  hidden: boolean;
  sortOrder: number;
}

export interface AchievementUnlock {
  threadId: string;
  achievementId: string;
  unlockedAt: string;
  progressJson: string | null;
}

export interface AchievementStats {
  total: number;
  unlocked: number;
  points: number;
}
