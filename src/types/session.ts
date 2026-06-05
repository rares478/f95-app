export interface PlaySession {
  id: number;
  threadId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
}

export interface RunningInfo {
  threadId: string;
  pid: number;
  elapsedSeconds: number;
}
