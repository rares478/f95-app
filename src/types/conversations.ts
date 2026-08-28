import type { PostAttachment } from './threadPosts';

export interface F95ConversationListItem {
  conversationId: string;
  conversationPath: string;
  title: string;
  url: string;
  starterUsername: string | null;
  starterUserId: string | null;
  recipients: string[];
  lastMessagePreview: string | null;
  lastMessageDate: string | null;
  isUnread: boolean;
  avatarUrl: string | null;
}

export interface F95ConversationsListResult {
  conversations: F95ConversationListItem[];
  hasMore: boolean;
  page: number;
}

export interface ConversationMessage {
  messageId: string;
  author: string;
  authorUserId: string | null;
  authorAvatarUrl: string | null;
  postedAt: string | null;
  html: string;
  attachments: PostAttachment[];
}

export interface F95ConversationDetail {
  conversationId: string;
  conversationPath: string;
  title: string;
  url: string;
  recipients: string[];
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  messages: ConversationMessage[];
}

export interface ConversationReplyResult {
  conversationPath: string;
  messageId: string | null;
}
