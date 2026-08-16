import express from 'express';
import http from 'http';
import {
  WebSocketServer,
  WebSocket,
} from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';

import {
  sessionManager,
} from './session/SessionManager';

dotenv.config();

// ============================================================
// EXPRESS
// ============================================================

const app =
  express();

app.use(
  cors()
);

app.use(
  express.json()
);

// ============================================================
// HTTP SERVER
// ============================================================

const server =
  http.createServer(app);

// ============================================================
// WEBSOCKET SERVER
// ============================================================

const wss =
  new WebSocketServer({
    server,
  });

const PORT =
  process.env.PORT ||
  3001;

// ============================================================
// HTTP ROUTES
// ============================================================

app.post(
  '/api/sessions',
  (_req, res) => {
    const sessionId =
      sessionManager.createSession();

    res.json({
      sessionId,
    });
  }
);

app.get(
  '/api/sessions/:sessionId',
  (req, res) => {
    const session =
      sessionManager.getSession(
        req.params.sessionId
      );

    if (!session) {
      return res.status(404).json({
        error:
          'Session not found or expired',
      });
    }

    res.json({
      sessionId:
        session.sessionId,

      status:
        session.status,

      participantCount:
        Object.keys(
          session.participants
        ).length,
    });
  }
);

// ============================================================
// CLIENT STATE
// ============================================================

interface ClientState {
  ws: WebSocket;
  sessionId?: string;
  participantId?: string;
}

const clients =
  new Map<
    WebSocket,
    ClientState
  >();

// ============================================================
// WEBSOCKET CONNECTION
// ============================================================

wss.on(
  'connection',
  (ws) => {
    console.log(
      '[WS] Client connected'
    );

    clients.set(
      ws,
      {
        ws,
      }
    );

    // --------------------------------------------------------
    // MESSAGE
    // --------------------------------------------------------

    ws.on(
      'message',
      (message) => {
        try {
          const data =
            JSON.parse(
              message.toString()
            );

          console.log(
            '[WS] MESSAGE:',
            data.type
          );

          handleWebSocketMessage(
            ws,
            data
          );
        } catch (error) {
          console.error(
            '[WS] Invalid WebSocket message:',
            error
          );
        }
      }
    );

    // --------------------------------------------------------
    // CLOSE
    // --------------------------------------------------------

    ws.on(
      'close',
      () => {
        const client =
          clients.get(ws);

        if (
          client?.sessionId &&
          client.participantId
        ) {
          const {
            sessionId,
            participantId,
          } = client;

          console.log(
            '[WS] Client left:',
            {
              sessionId,
              participantId,
            }
          );

          sessionManager.leaveSession(
            sessionId,
            participantId
          );

          broadcastToSession(
            sessionId,
            {
              type:
                'PEER_LEFT',

              sessionId,

              participantId,
            },
            ws
          );
        }

        clients.delete(
          ws
        );
      }
    );

    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------

    ws.on(
      'error',
      (error) => {
        console.error(
          '[WS] Socket error:',
          error
        );
      }
    );
  }
);

// ============================================================
// MESSAGE HANDLER
// ============================================================

function handleWebSocketMessage(
  ws: WebSocket,
  data: any
) {
  const {
    type,
    sessionId,
    participantId,
  } = data;

  // ----------------------------------------------------------
  // VALIDATE
  // ----------------------------------------------------------

  if (
    !sessionId ||
    !participantId
  ) {
    console.warn(
      '[WS] Message missing sessionId or participantId:',
      data
    );

    return;
  }

  // ----------------------------------------------------------
  // UPDATE CLIENT STATE
  // ----------------------------------------------------------

  const client =
    clients.get(ws);

  if (client) {
    client.sessionId =
      sessionId;

    client.participantId =
      participantId;
  }

  // ----------------------------------------------------------
  // ACTIVITY
  // ----------------------------------------------------------

  sessionManager.updateActivity(
    sessionId
  );

  // ==========================================================
  // SWITCH
  // ==========================================================

  switch (type) {

    // ========================================================
    // SESSION JOIN
    // ========================================================

    case 'SESSION_JOIN': {

      console.log(
        '[WS] SESSION_JOIN:',
        {
          sessionId,
          participantId,
          displayName:
            data.displayName,
        }
      );

      const success =
        sessionManager.joinSession(
          sessionId,
          participantId,
          data.displayName
        );

      if (!success) {

        ws.send(
          JSON.stringify({
            type:
              'ERROR',

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

      if (!session) {
        ws.send(
          JSON.stringify({
            type:
              'ERROR',

            message:
              'Session not found',
          })
        );

        return;
      }

      // ------------------------------------------------------
      // SEND CURRENT SESSION TO JOINER
      // ------------------------------------------------------

      ws.send(
        JSON.stringify({
          type:
            'SESSION_STATE',

          sessionId,

          state:
            session,
        })
      );

      console.log(
        '[WS] SESSION_STATE sent:',
        {
          sessionId,

          participantCount:
            Object.keys(
              session.participants
            ).length,
        }
      );

      // ------------------------------------------------------
      // NOTIFY BOTH PARTICIPANTS
      // ------------------------------------------------------

      broadcastToSession(
        sessionId,
        {
          type:
            'PEER_JOINED',

          sessionId,

          participantId,

          displayName:
            data.displayName,
        }
      );

      break;
    }

    // ========================================================
    // WEBRTC OFFER
    // ========================================================

    case 'WEBRTC_OFFER': {

      console.log(
        '[WS] WEBRTC_OFFER:',
        {
          sessionId,
          from:
            participantId,
        }
      );

      broadcastToSession(
        sessionId,
        data,
        ws
      );

      break;
    }

    // ========================================================
    // WEBRTC ANSWER
    // ========================================================

    case 'WEBRTC_ANSWER': {

      console.log(
        '[WS] WEBRTC_ANSWER:',
        {
          sessionId,
          from:
            participantId,
        }
      );

      broadcastToSession(
        sessionId,
        data,
        ws
      );

      break;
    }

    // ========================================================
    // WEBRTC ICE
    // ========================================================

    case 'WEBRTC_ICE': {

      console.log(
        '[WS] WEBRTC_ICE:',
        {
          sessionId,
          from:
            participantId,
        }
      );

      broadcastToSession(
        sessionId,
        data,
        ws
      );

      break;
    }

    // ========================================================
    // CHAT
    // ========================================================

    case 'CHAT_MESSAGE':

    case 'CHAT_TYPING':

    case 'CHAT_STOP_TYPING': {

      broadcastToSession(
        sessionId,
        data,
        ws
      );

      break;
    }

    // ========================================================
    // MUSIC
    // ========================================================

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
          type ===
          'MUSIC_PLAY'
        ) {
          session.isPlaying =
            true;
        }

        if (
          type ===
          'MUSIC_PAUSE'
        ) {
          session.isPlaying =
            false;
        }

        if (
          data.position !==
          undefined
        ) {
          session.playbackPosition =
            data.position;
        }

        if (
          data.trackId !==
          undefined
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

    // ========================================================
    // UNKNOWN
    // ========================================================

    default: {

      console.warn(
        '[WS] Unknown message type:',
        type
      );

      break;
    }
  }
}

// ============================================================
// BROADCAST
// ============================================================

function broadcastToSession(
  sessionId: string,
  message: any,
  excludeWs?: WebSocket
) {
  for (
    const [
      ws,
      client,
    ] of clients.entries()
  ) {

    if (
      client.sessionId ===
      sessionId &&

      ws !==
      excludeWs &&

      ws.readyState ===
      WebSocket.OPEN
    ) {

      try {

        ws.send(
          JSON.stringify(
            message
          )
        );

      } catch (error) {

        console.error(
          '[WS] Broadcast failed:',
          error
        );

      }
    }
  }
}

// ============================================================
// SERVER START
// ============================================================

server.listen(
  PORT,
  () => {
    console.log(
      `Server listening on port ${PORT}`
    );
  }
);