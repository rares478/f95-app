export interface ActivityItem {
  avatarUrl: string | null;
  title: string;
  snippet: string | null;
  date: string | null;
  url: string | null;
}

export interface PaginatedProfilePosts {
  items: ProfilePostItem[];
  page: number;
  totalPages: number | null;
  hasMore: boolean;
}

export interface PaginatedActivity {
  items: ActivityItem[];
  page: number;
  totalPages: number | null;
  hasMore: boolean;
}

export interface ProfilePostItem {
  authorName: string;
  authorAvatarUrl: string | null;
  messageHtml: string | null;
  messageText: string;
  date: string | null;
  url: string | null;
}

export interface ProfileBadge {
  label: string;
  variant:
    | 'moderator'
    | 'staff'
    | 'donor'
    | 'compressor'
    | 'uploader'
    | 'developer'
    | 'default';
}

export interface ProfileDto {
  username: string;
  avatarUrl: string | null;
  alerts: number;
  conversations: number;
  userId: string | null;
  profileUrl: string | null;
  userBanner: string | null;
  customTitle: string | null;
  joinedAt: string | null;
  lastSeen: string | null;
  messagesCount: number | null;
  reactionScore: number | null;
  trophyPoints: number | null;
  points: number | null;
  ratingsReceived: number | null;
  donations?: string | null;
  userBanners?: ProfileBadge[];
  tags?: string[];
  profilePosts?: ProfilePostItem[];
  extraStats: Record<string, string>;
  activity: ActivityItem[];
}

export interface BackendError {
  code: BackendErrorCode;
  message: string;
}

export type BackendErrorCode =
  | 'invalid_credentials'
  | 'two_factor_required'
  | 'cloudflare'
  | 'not_initialized'
  | 'sidecar_timeout'
  | 'sidecar_crash'
  | 'protocol'
  | 'io'
  | 'other';

export function isBackendError(err: unknown): err is BackendError {
  return (
    !!err &&
    typeof err === 'object' &&
    typeof (err as BackendError).code === 'string' &&
    typeof (err as BackendError).message === 'string'
  );
}
