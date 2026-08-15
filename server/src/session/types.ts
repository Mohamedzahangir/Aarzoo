export type SessionStatus = 'WAITING' | 'CONNECTED' | 'ACTIVE' | 'ENDED' | 'EXPIRED';

export interface Participant {
  participantId: string;
  displayName?: string;
  joinedAt: number;
  lastSeen: number;
}

export interface Session {
  sessionId: string;
  participants: Record<string, Participant>;
  createdAt: number;
  lastActivity: number;
  status: SessionStatus;
  
  // Media State
  currentTrack?: string;
  isPlaying: boolean;
  playbackPosition: number;
  updatedAt: number;
  queue: string[];
  
  // Watch State
  currentVideo?: string;
  videoPosition: number;
  videoPlaying: boolean;
}
