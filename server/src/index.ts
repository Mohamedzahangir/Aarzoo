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

const app =
  express();

app.use(
  cors()
);

app.use(
  express.json()
);

const server =
  http.createServer(app);

const wss =
  new WebSocketServer({
    server,
  });

const PORT =
  process.env.PORT || 3001;

// ============================================================
// HTTP
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
// END SESSION
// ============================================================

function endSession(
  sessionId: string,
  leavingParticipantId: string,
  excludeWs?: WebSocket
) {
  console.log(
    '[WS] Ending session:',
    {
      sessionId,
      leavingParticipantId,
    }
  );

  /*
   * Tell everyone still connected that the session is over.
   */
  broadcastToSession(
    sessionId,
    {
      type:
        'SESSION_ENDED',

      sessionId,

      participantId:
        leavingParticipantId,
    },
    excludeWs
  );

  /*
   * Remove the leaving participant from the session manager.
   */
  try {
    sessionManager.leaveSession(
      sessionId,
      leavingParticipantId
    );
  } catch (error) {
    console.error(
      '[WS] Failed to leave session:',
      error
    );
  }
}

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
      { ws }
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
            '[WS] Invalid message:',
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
          client?.participantId
        ) {
          console.log(
            '[WS] Unexpected disconnect:',
            {
              sessionId:
                client.sessionId,

              participantId:
                client.participantId,
            }
          );

          endSession(
            client.sessionId,
            client.participantId,
            ws
          );
        }

        clients.delete(ws);
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

  if (
    !sessionId ||
    !participantId
  ) {
    console.warn(
      '[WS] Missing sessionId/participantId'
    );

    return;
  }

  const client =
    clients.get(ws);

  if (client) {
    client.sessionId =
      sessionId;

    client.participantId =
      participantId;
  }

  sessionManager.updateActivity(
    sessionId
  );

  // ==========================================================
  // SESSION JOIN
  // ==========================================================

  if (
    type ===
    'SESSION_JOIN'
  ) {
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

    // Send current session to joining user.
    ws.send(
      JSON.stringify({
        type:
          'SESSION_STATE',

        sessionId,

        state:
          session,
      })
    );

    /*
     * Tell both participants that a participant joined.
     */
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

    return;
  }

  // ==========================================================
  // SESSION LEAVE
  // ==========================================================

  if (
    type ===
    'SESSION_LEAVE'
  ) {
    console.log(
      '[WS] SESSION_LEAVE:',
      {
        sessionId,
        participantId,
      }
    );

    /*
     * Tell the other participant to leave too.
     */
    endSession(
      sessionId,
      participantId,
      ws
    );

    /*
     * The person who clicked hang-up is already navigating
     * home, so close their socket.
     */
    try {
      ws.close();
    } catch {
      // Ignore close error.
    }

    clients.delete(ws);

    return;
  }

  // ==========================================================
  // WEBRTC OFFER
  // ==========================================================

  if (
    type ===
    'WEBRTC_OFFER'
  ) {
    broadcastToSession(
      sessionId,
      data,
      ws
    );

    return;
  }

  // ==========================================================
  // WEBRTC ANSWER
  // ==========================================================

  if (
    type ===
    'WEBRTC_ANSWER'
  ) {
    broadcastToSession(
      sessionId,
      data,
      ws
    );

    return;
  }

  // ==========================================================
  // WEBRTC ICE
  // ==========================================================

  if (
    type ===
    'WEBRTC_ICE'
  ) {
    broadcastToSession(
      sessionId,
      data,
      ws
    );

    return;
  }

  // ==========================================================
  // CHAT
  // ==========================================================

  if (
    type ===
    'CHAT_MESSAGE' ||
    type ===
    'CHAT_TYPING' ||
    type ===
    'CHAT_STOP_TYPING'
  ) {
    broadcastToSession(
      sessionId,
      data,
      ws
    );

    return;
  }

  // ==========================================================
  // MUSIC
  // ==========================================================

  if (
    type ===
    'MUSIC_PLAY' ||
    type ===
    'MUSIC_PAUSE' ||
    type ===
    'MUSIC_SEEK' ||
    type ===
    'MUSIC_TRACK_CHANGE'
  ) {
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

    return;
  }

  console.warn(
    '[WS] Unknown message:',
    type
  );
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
      ws !== excludeWs &&
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
// START
// ============================================================

server.listen(
  PORT,
  () => {
    console.log(
      `Server listening on port ${PORT}`
    );
  }
);