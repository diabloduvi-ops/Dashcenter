export type MediaPlaybackState = "playing" | "paused";
export type MediaPlayMethod = "transcode" | "direct-play" | "direct-stream" | "unknown";

export interface MediaActivitySession {
  id: string;
  title: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  client?: string;
  device?: string;
  username?: string;
  state: MediaPlaybackState;
  playMethod: MediaPlayMethod;
  progressPercent: number;
  positionSeconds: number;
  durationSeconds: number;
  quality?: string;
  artworkId?: string;
}

export interface MediaActivity {
  active: number;
  sessions: MediaActivitySession[];
  truncated: boolean;
}
