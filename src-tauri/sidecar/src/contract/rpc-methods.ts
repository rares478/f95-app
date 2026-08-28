/**
 * Fonte de verdade dos métodos JSON-RPC expostos pelo sidecar Node.
 * Mantenha em sync com src/sidecar/rpc.rs no Rust.
 */
export const RPC_METHODS = {
  init: {
    params: { sessionDir: 'string', sessionId: 'string' },
    result: { sessionId: 'string' },
  },
  ping: {
    params: {},
    result: { ok: 'boolean' },
  },
  login: {
    params: { username: 'string', password: 'string' },
    result: 'unknown',
  },
  logout: {
    params: {},
    result: { ok: 'boolean' },
  },
  getProfile: {
    params: {},
    result: 'ProfileDto',
  },
  getMemberProfile: {
    params: { userId: 'string' },
    result: 'ProfileDto',
  },
  getMemberProfilePosts: {
    params: { userId: 'string', page: 'number?' },
    result: 'PaginatedProfilePosts',
  },
  getMemberActivity: {
    params: { userId: 'string', page: 'number?' },
    result: 'PaginatedActivity',
  },
  isLoggedIn: {
    params: {},
    result: { loggedIn: 'boolean' },
  },
  samList: {
    params: { filters: 'SamFilters' },
    result: 'unknown',
  },
  samOptions: {
    params: { category: 'string' },
    result: 'unknown',
  },
  gameDetail: {
    params: { threadId: 'string' },
    result: 'unknown',
  },
  threadPosts: {
    params: { threadId: 'string', page: 'number?' },
    result: 'unknown',
  },
  threadReply: {
    params: { threadId: 'string', message: 'string' },
    result: { threadId: 'string', postId: 'string|null', page: 'number|null' },
  },
  bbcodePreview: {
    params: { threadId: 'string', bbCode: 'string' },
    result: { html: 'string' },
  },
  resolvePost: {
    params: { postId: 'string?', url: 'string?' },
    result: {
      threadId: 'string',
      postId: 'string?',
      page: 'number?',
      forum: 'string?',
    },
  },
  getFollowing: {
    params: {},
    result: 'unknown',
  },
  fetchRss: {
    params: { category: 'string?' },
    result: 'RssFeed',
  },
  fetchAlertsPopup: {
    params: {},
    result: 'F95AlertsPopupResult',
  },
  fetchAlertsList: {
    params: { page: 'number?' },
    result: 'F95AlertsListResult',
  },
  forumSearch: {
    params: {
      query: 'string',
      titleOnly: 'boolean?',
      searchIn: 'string?',
      sort: 'string?',
      page: 'number?',
      threadId: 'string?',
    },
    result: 'ForumSearchPage',
  },
  unmaskUrl: {
    params: { url: 'string' },
    result: { url: 'string', status: 'number' },
  },
  downloadPostAttachment: {
    params: { url: 'string', fileName: 'string', destDir: 'string' },
    result: { path: 'string' },
  },
  resolveBuzzheavier: {
    params: { url: 'string', accountId: 'string?' },
    result: { directUrl: 'string', fileName: 'string', fileSize: 'number?' },
  },
  resolveGdrive: {
    params: { url: 'string' },
    result: { directUrl: 'string', fileName: 'string', fileSize: 'number?' },
  },
  resolveGofile: {
    params: { url: 'string', accountToken: 'string?' },
    result: {
      files: 'Array<{ id: string; directUrl: string; fileName: string; fileSize?: number; platformLabel?: string }>',
      extraHeaders: 'Array<{ name: string; value: string }>',
    },
  },
  resolveWorkupload: {
    params: { url: 'string' },
    result: {
      directUrl: 'string',
      fileName: 'string',
      fileSize: 'number?',
      extraHeaders: 'Array<{ name: string; value: string }>',
    },
  },
  resolveMixdrop: {
    params: { url: 'string', apiEmail: 'string?', apiKey: 'string?' },
    result: {
      directUrl: 'string',
      fileName: 'string',
      fileSize: 'number?',
      extraHeaders: 'Array<{ name: string; value: string }>',
    },
  },
  resolveMixdropWithCookies: {
    params: { url: 'string', cookieHeader: 'string', apiEmail: 'string?', apiKey: 'string?' },
    result: {
      directUrl: 'string',
      fileName: 'string',
      fileSize: 'number?',
      extraHeaders: 'Array<{ name: string; value: string }>',
    },
  },
  resolveMixdropInteractive: {
    params: { url: 'string', apiEmail: 'string?', apiKey: 'string?' },
    result: {
      directUrl: 'string',
      fileName: 'string',
      fileSize: 'number?',
      extraHeaders: 'Array<{ name: string; value: string }>',
    },
  },
  close: {
    params: {},
    result: { ok: 'boolean' },
  },
} as const;

export type RpcMethodName = keyof typeof RPC_METHODS;

export const RPC_ERROR_CODES = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  INVALID_CREDENTIALS: -32001,
  TWO_FACTOR_REQUIRED: -32002,
  NOT_INITIALIZED: -32003,
  CLOUDFLARE_CHALLENGE: -32010,
} as const;
