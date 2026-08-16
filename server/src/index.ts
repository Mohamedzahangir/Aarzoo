import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { sessionManager } from './session/SessionManager';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3001;

app.post('/api/sessions', (_req, res) => {
  const sessionId = sessionManager.createSession();
  res.json({ sessionId });
});

app.get('/api/sessions/:sessionId', (req, res) => {
  const session = sessionManager.getSession(req.params.sessionId);

  if (!session) {
    return res.status(404).json({
      error: 'Session not found or expired',
    });
  }

  res.json({
    sessionId: session.sessionId,
    status: session.status,
    participantCount: Object.keys(session.participants).length,
  });
});

interface ClientState {
  ws: WebSocket;
  sessionId?: string;
  participantId?: string;
}

const clients = new Map<WebSocket, ClientState>();

wss.on('connection', (ws) => {
  clients.set(ws, { ws });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      handleWebSocketMessage(ws, data);
    } catch (error) {
      console.error('Invalid WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);

    if (
      client?.sessionId &&
      client.participantId
    ) {
      const { sessionId, participantId } =
        client;

      sessionManager.leaveSession(
        sessionId,
        participantId
      );

      broadcastToSession(
        sessionId,
        {
          type: 'PEER_LEFT',
          sessionId,
          participantId,
        },
        ws
      );
    }

    clients.delete(ws);
  });
});

function handleWebSocketMessage(
  ws: WebSocket,
  data: any
) {
  const {
    type,
    sessionId,
    participantId,
  } = data;

  if (!sessionId || !participantId) {
    return;
  }

  const client = clients.get(ws);

  if (client) {
    client.sessionId = sessionId;
    client.participantId =
      participantId;
  }

  sessionManager.updateActivity(
    sessionId
  );

  switch (type) {
    case 'SESSION_JOIN': {
      const success =
        sessionManager.joinSession(
          sessionId,
          participantId,
          data.displayName
        );

      if (!success) {
        ws.send(
          JSON.stringify({
            type: 'ERROR',
            message:
              'Session full or invalid',
          })
        );

        ws.close();
        return;
      }

      const session =
        sessionManager.getSession(
          sessionId
        );

      ws.send(
        JSON.stringify({
          type: 'SESSION_STATE',
          sessionId,
          state: session,
        })
      );

      /*
       * IMPORTANT:
       * Notify both clients that this participant
       * joined. Each client ignores its own message.
       *
       * This removes the old asymmetry where only the
       * already-connected participant received PEER_JOINED.
       */
      broadcastToSession(sessionId, {
        type: 'PEER_JOINED',
        sessionId,
        participantId,
        displayName:
          data.displayName,
      });

      break;
    }

    case 'WEBRTC_OFFER':
    case 'WEBRTC_ANSWER':
    case 'WEBRTC_ICE':
      broadcastToSession(
        sessionId,
        data,
        ws
      );
      break;

    case 'CHAT_MESSAGE':
    case 'CHAT_TYPING':
    case 'CHAT_STOP_TYPING':
      broadcastToSession(
        sessionId,
        data,
        ws
      );
      break;

    case 'MUSIC_PLAY':
    case 'MUSIC_PAUSE':
    case 'MUSIC_SEEK':
    case 'MUSIC_TRACK_CHANGE': {
      const session =
        sessionManager.getSession(
          sessionId
        );

      if (session) {
        if (
          type === 'MUSIC_PLAY'
        ) {
          session.isPlaying = true;
        }

        if (
          type === 'MUSIC_PAUSE'
        ) {
          session.isPlaying = false;
        }

        if (
          data.position !== undefined
        ) {
          session.playbackPosition =
            data.position;
        }

        if (
          data.trackId !== undefined
        ) {
          session.currentTrack =
            data.trackId;
        }

        session.updatedAt =
          Date.now();
      }

      broadcastToSession(
        sessionId,
        data,
        ws
      );

      break;
    }

    default:
      break;
  }
}

function broadcastToSession(
  sessionId: string,
  message: any,
  excludeWs?: WebSocket
) {
  for (
    const [ws, client] of clients.entries()
  ) {
    if (
      client.sessionId ===
      sessionId &&
      ws !== excludeWs &&
      ws.readyState ===
      WebSocket.OPEN
    ) {
      ws.send(
        JSON.stringify(message)
      );
    }
  }
}

server.listen(PORT, () => {
  console.log(
    `Server listening on port ${PORT}`
  );
});