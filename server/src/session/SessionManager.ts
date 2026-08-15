import { Session, SessionStatus, Participant } from './types';
import crypto from 'crypto';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private readonly SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour inactivity timeout

  constructor() {
    // Cleanup interval for expired sessions
    setInterval(() => this.cleanupExpiredSessions(), 60 * 1000);
  }

  public createSession(): string {
    const sessionId = this.generateSessionId();
    const now = Date.now();
    
    this.sessions.set(sessionId, {
      sessionId,
      participants: {},
      createdAt: now,
      lastActivity: now,
      status: 'WAITING',
      isPlaying: false,
      playbackPosition: 0,
      updatedAt: now,
      queue: [],
      videoPosition: 0,
      videoPlaying: false
    });

    return sessionId;
  }

  public getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  public joinSession(sessionId: string, participantId: string, displayName?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Reject if session is full (exactly 2 participants)
    const participantCount = Object.keys(session.participants).length;
    if (participantCount >= 2 && !session.participants[participantId]) {
      return false; // Session full
    }

    const now = Date.now();
    session.participants[participantId] = {
      participantId,
      displayName,
      joinedAt: session.participants[participantId]?.joinedAt || now,
      lastSeen: now,
    };
    session.lastActivity = now;

    const newParticipantCount = Object.keys(session.participants).length;
    if (newParticipantCount === 2 && session.status === 'WAITING') {
      session.status = 'CONNECTED';
    }

    return true;
  }

  public leaveSession(sessionId: string, participantId: string) {
    const session = this.sessions.get(sessionId);
    if (session && session.participants[participantId]) {
      delete session.participants[participantId];
      
      const count = Object.keys(session.participants).length;
      if (count === 0) {
        session.status = 'ENDED';
      }
    }
  }

  public updateActivity(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  private cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.SESSION_TIMEOUT_MS || session.status === 'ENDED') {
        this.sessions.delete(sessionId);
      }
    }
  }

  private generateSessionId(): string {
    // Generate a secure, non-guessable 8 character ID
    return crypto.randomBytes(4).toString('hex');
  }
}

export const sessionManager = new SessionManager();
