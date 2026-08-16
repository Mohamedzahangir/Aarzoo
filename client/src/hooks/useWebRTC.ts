import { useEffect, useRef, useState } from 'react';

interface WebRTCProps {
  ws: WebSocket | null;
  sessionId: string | undefined;
  participantId: string;
  cameraOn: boolean;
  micOn: boolean;
}

interface SignalMessage {
  type: string;
  sessionId?: string;
  participantId?: string;
  candidate?: RTCIceCandidateInit;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
}

export function useWebRTC({
  ws,
  sessionId,
  participantId,
  cameraOn,
  micOn,
}: WebRTCProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const peerConnection = useRef<RTCPeerConnection | null>(null);

  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const pendingSignals = useRef<SignalMessage[]>([]);

  const remoteMediaStream = useRef<MediaStream | null>(null);

  const remoteParticipantId = useRef<string | null>(null);

  const makingOffer = useRef(false);
  const offerSent = useRef(false);

  // ============================================================
  // GET LOCAL CAMERA + MICROPHONE
  // ============================================================

  useEffect(() => {
    let mounted = true;
    let stream: MediaStream | null = null;

    const setupLocalStream = async () => {
      try {
        console.log('[WEBRTC] Requesting camera + microphone...');

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
          audio: true,
        });

        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        console.log('[WEBRTC] Local media acquired');

        setLocalStream(stream);
      } catch (error) {
        console.error(
          '[WEBRTC] Failed to get local media:',
          error
        );
      }
    };

    setupLocalStream();

    return () => {
      mounted = false;

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ============================================================
  // CAMERA / MICROPHONE TOGGLE
  // ============================================================

  useEffect(() => {
    if (!localStream) return;

    localStream.getVideoTracks().forEach((track) => {
      track.enabled = cameraOn;
    });

    localStream.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });

    console.log('[WEBRTC] Media state changed:', {
      cameraOn,
      micOn,
    });
  }, [localStream, cameraOn, micOn]);

  // ============================================================
  // WEBSOCKET SIGNALING LISTENER
  //
  // IMPORTANT:
  // This listener is installed as soon as the WebSocket exists.
  // It does NOT wait for localStream.
  // ============================================================

  useEffect(() => {
    if (!ws || !sessionId) return;

    console.log('[WEBRTC] Installing signaling listener');

    const handleMessage = (event: MessageEvent) => {
      try {
        const data: SignalMessage = JSON.parse(event.data);

        // Ignore messages from another session
        if (
          data.sessionId &&
          data.sessionId !== sessionId
        ) {
          return;
        }

        // Ignore our own messages
        if (
          data.participantId &&
          data.participantId === participantId
        ) {
          return;
        }

        const signalingTypes = [
          'PEER_JOINED',
          'WEBRTC_OFFER',
          'WEBRTC_ANSWER',
          'WEBRTC_ICE',
          'PEER_LEFT',
        ];

        if (signalingTypes.includes(data.type)) {
          console.log(
            '[WEBRTC] SIGNAL RECEIVED:',
            data.type,
            data
          );
        }

        /*
         * Store the signal until the PeerConnection exists.
         * This prevents PEER_JOINED from being lost if
         * getUserMedia takes longer than the WebSocket.
         */
        pendingSignals.current.push(data);

        // Safety limit
        if (pendingSignals.current.length > 100) {
          pendingSignals.current.shift();
        }
      } catch (error) {
        console.error(
          '[WEBRTC] Failed to parse WebSocket message:',
          error
        );
      }
    };

    ws.addEventListener('message', handleMessage);

    return () => {
      console.log('[WEBRTC] Removing signaling listener');

      ws.removeEventListener('message', handleMessage);
    };
  }, [ws, sessionId, participantId]);

  // ============================================================
  // CREATE WEBRTC PEER CONNECTION
  // ============================================================

  useEffect(() => {
    if (!ws || !sessionId || !localStream) {
      console.log('[WEBRTC] Waiting for prerequisites:', {
        hasWebSocket: !!ws,
        hasSession: !!sessionId,
        hasLocalStream: !!localStream,
      });

      return;
    }

    console.log('[WEBRTC] Creating PeerConnection...');

    const pc = new RTCPeerConnection({
      iceServers: [
        // STUN
        {
          urls: 'stun:stun.relay.metered.ca:80',
        },

        // TURN UDP
        {
          urls: 'turn:global.relay.metered.ca:80',
          username: 'bccfab4c5208dda4f5970d61',
          credential: 'woyZUA3Cd0nbwoFt',
        },

        // TURN TCP
        {
          urls: 'turn:global.relay.metered.ca:80?transport=tcp',
          username: 'bccfab4c5208dda4f5970d61',
          credential: 'woyZUA3Cd0nbwoFt',
        },

        // TURN TLS
        {
          urls: 'turn:global.relay.metered.ca:443',
          username: 'bccfab4c5208dda4f5970d61',
          credential: 'woyZUA3Cd0nbwoFt',
        },

        // TURN TLS TCP
        {
          urls: 'turns:global.relay.metered.ca:443?transport=tcp',
          username: 'bccfab4c5208dda4f5970d61',
          credential: 'woyZUA3Cd0nbwoFt',
        },
      ],
    });

    peerConnection.current = pc;

    console.log('[WEBRTC] PeerConnection created');

    // ==========================================================
    // ADD LOCAL TRACKS
    // ==========================================================

    localStream.getTracks().forEach((track) => {
      console.log(
        '[WEBRTC] Adding local track:',
        track.kind,
        track.id
      );

      pc.addTrack(track, localStream);
    });

    // ==========================================================
    // REMOTE TRACK
    // ==========================================================

    pc.ontrack = (event) => {
      console.log('[WEBRTC] REMOTE TRACK RECEIVED:', {
        kind: event.track.kind,
        id: event.track.id,
        streams: event.streams.length,
      });

      if (!remoteMediaStream.current) {
        remoteMediaStream.current = new MediaStream();
      }

      const existingTrack =
        remoteMediaStream.current
          .getTracks()
          .find(
            (track) => track.id === event.track.id
          );

      if (!existingTrack) {
        remoteMediaStream.current.addTrack(
          event.track
        );
      }

      setRemoteStream(
        remoteMediaStream.current
      );

      console.log(
        '[WEBRTC] Remote stream tracks:',
        remoteMediaStream.current
          .getTracks()
          .map((track) => ({
            kind: track.kind,
            id: track.id,
            enabled: track.enabled,
            readyState: track.readyState,
          }))
      );
    };

    // ==========================================================
    // SEND SIGNAL
    // ==========================================================

    const sendSignal = (
      message: SignalMessage
    ): boolean => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn(
          '[WEBRTC] WebSocket is not open:',
          ws.readyState
        );

        return false;
      }

      try {
        ws.send(JSON.stringify(message));

        console.log(
          '[WEBRTC] SIGNAL SENT:',
          message.type
        );

        return true;
      } catch (error) {
        console.error(
          '[WEBRTC] Failed to send signal:',
          error
        );

        return false;
      }
    };

    // ==========================================================
    // ICE CANDIDATE
    // ==========================================================

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        console.log(
          '[WEBRTC] ICE gathering complete'
        );

        return;
      }

      console.log(
        '[WEBRTC] Sending ICE candidate:',
        event.candidate.candidate
      );

      sendSignal({
        type: 'WEBRTC_ICE',
        sessionId,
        participantId,
        candidate: event.candidate.toJSON(),
      });
    };

    // ==========================================================
    // ICE GATHERING STATE
    // ==========================================================

    pc.onicegatheringstatechange = () => {
      console.log(
        '[WEBRTC] ICE gathering state:',
        pc.iceGatheringState
      );
    };

    // ==========================================================
    // ICE CONNECTION STATE
    // ==========================================================

    pc.oniceconnectionstatechange = () => {
      console.log(
        '[WEBRTC] ICE CONNECTION STATE:',
        pc.iceConnectionState
      );

      if (
        pc.iceConnectionState === 'checking'
      ) {
        console.log(
          '[WEBRTC] ICE checking...'
        );
      }

      if (
        pc.iceConnectionState === 'connected'
      ) {
        console.log(
          '[WEBRTC] ICE CONNECTED ✅'
        );
      }

      if (
        pc.iceConnectionState === 'completed'
      ) {
        console.log(
          '[WEBRTC] ICE COMPLETED ✅'
        );
      }

      if (
        pc.iceConnectionState === 'disconnected'
      ) {
        console.warn(
          '[WEBRTC] ICE DISCONNECTED ⚠️'
        );
      }

      if (
        pc.iceConnectionState === 'failed'
      ) {
        console.error(
          '[WEBRTC] ICE FAILED ❌'
        );
      }

      if (
        pc.iceConnectionState === 'closed'
      ) {
        console.log(
          '[WEBRTC] ICE CLOSED'
        );
      }
    };

    // ==========================================================
    // PEER CONNECTION STATE
    // ==========================================================

    pc.onconnectionstatechange = () => {
      console.log(
        '[WEBRTC] CONNECTION STATE:',
        pc.connectionState
      );

      if (
        pc.connectionState === 'new'
      ) {
        console.log(
          '[WEBRTC] Connection new'
        );
      }

      if (
        pc.connectionState === 'connecting'
      ) {
        console.log(
          '[WEBRTC] Connection connecting...'
        );
      }

      if (
        pc.connectionState === 'connected'
      ) {
        console.log(
          '[WEBRTC] PEER CONNECTION CONNECTED ✅'
        );
      }

      if (
        pc.connectionState === 'disconnected'
      ) {
        console.warn(
          '[WEBRTC] PEER CONNECTION DISCONNECTED ⚠️'
        );
      }

      if (
        pc.connectionState === 'failed'
      ) {
        console.error(
          '[WEBRTC] PEER CONNECTION FAILED ❌'
        );
      }

      if (
        pc.connectionState === 'closed'
      ) {
        console.log(
          '[WEBRTC] PEER CONNECTION CLOSED'
        );
      }
    };

    // ==========================================================
    // SIGNALING STATE
    // ==========================================================

    pc.onsignalingstatechange = () => {
      console.log(
        '[WEBRTC] SIGNALING STATE:',
        pc.signalingState
      );
    };

    // ==========================================================
    // NEGOTIATION
    // ==========================================================

    pc.onnegotiationneeded = () => {
      console.log(
        '[WEBRTC] Negotiation needed'
      );
    };

    // ==========================================================
    // FLUSH PENDING ICE CANDIDATES
    // ==========================================================

    const flushPendingCandidates =
      async () => {
        if (!pc.remoteDescription) {
          return;
        }

        if (
          pendingCandidates.current.length ===
          0
        ) {
          return;
        }

        console.log(
          '[WEBRTC] Flushing pending ICE:',
          pendingCandidates.current.length
        );

        const candidates = [
          ...pendingCandidates.current,
        ];

        pendingCandidates.current = [];

        for (const candidate of candidates) {
          try {
            await pc.addIceCandidate(
              new RTCIceCandidate(candidate)
            );

            console.log(
              '[WEBRTC] Pending ICE added'
            );
          } catch (error) {
            console.error(
              '[WEBRTC] Failed to add pending ICE:',
              error
            );
          }
        }
      };

    // ==========================================================
    // PROCESS SIGNAL
    // ==========================================================

    const processSignal = async (
      data: SignalMessage
    ) => {
      // ========================================================
      // PEER JOINED
      // ========================================================

      if (
        data.type === 'PEER_JOINED' &&
        data.participantId &&
        data.participantId !== participantId
      ) {
        remoteParticipantId.current =
          data.participantId;

        console.log(
          '[WEBRTC] Peer joined:',
          data.participantId
        );

        /*
         * Deterministic initiator.
         *
         * Only one participant creates the offer.
         */
        const shouldInitiate =
          participantId <
          data.participantId;

        console.log(
          '[WEBRTC] Initiator decision:',
          {
            local: participantId,
            remote: data.participantId,
            shouldInitiate,
          }
        );

        if (
          shouldInitiate &&
          !offerSent.current &&
          pc.signalingState === 'stable'
        ) {
          try {
            makingOffer.current = true;

            console.log(
              '[WEBRTC] Creating OFFER...'
            );

            /*
             * IMPORTANT:
             *
             * No iceRestart here.
             *
             * This is the initial connection.
             */
            const offer =
              await pc.createOffer();

            await pc.setLocalDescription(
              offer
            );

            console.log(
              '[WEBRTC] Local OFFER set'
            );

            const sent = sendSignal({
              type: 'WEBRTC_OFFER',
              sessionId,
              participantId,
              offer:
                pc.localDescription!.toJSON(),
            });

            if (sent) {
              offerSent.current = true;

              console.log(
                '[WEBRTC] OFFER SENT ✅'
              );
            }
          } catch (error) {
            console.error(
              '[WEBRTC] Failed to create OFFER:',
              error
            );
          } finally {
            makingOffer.current = false;
          }
        }

        return;
      }

      // ========================================================
      // RECEIVE OFFER
      // ========================================================

      if (
        data.type === 'WEBRTC_OFFER' &&
        data.participantId !== participantId &&
        data.offer
      ) {
        remoteParticipantId.current =
          data.participantId ?? null;

        console.log(
          '[WEBRTC] OFFER RECEIVED'
        );

        try {
          /*
           * If both sides somehow generated an offer,
           * the deterministic participant ID decides
           * who keeps their offer.
           */
          if (
            makingOffer.current &&
            participantId <
            (data.participantId ?? '')
          ) {
            console.warn(
              '[WEBRTC] Ignoring competing OFFER'
            );

            return;
          }

          /*
           * If we already have a local offer,
           * rollback it before accepting the remote offer.
           */
          if (
            pc.signalingState ===
            'have-local-offer'
          ) {
            console.log(
              '[WEBRTC] Rolling back local OFFER'
            );

            await pc.setLocalDescription({
              type: 'rollback',
            });
          }

          await pc.setRemoteDescription(
            new RTCSessionDescription(
              data.offer
            )
          );

          console.log(
            '[WEBRTC] Remote OFFER applied'
          );

          await flushPendingCandidates();

          const answer =
            await pc.createAnswer();

          await pc.setLocalDescription(
            answer
          );

          console.log(
            '[WEBRTC] Local ANSWER set'
          );

          sendSignal({
            type: 'WEBRTC_ANSWER',
            sessionId,
            participantId,
            answer:
              pc.localDescription!.toJSON(),
          });

          console.log(
            '[WEBRTC] ANSWER SENT ✅'
          );
        } catch (error) {
          console.error(
            '[WEBRTC] Failed processing OFFER:',
            error
          );
        }

        return;
      }

      // ========================================================
      // RECEIVE ANSWER
      // ========================================================

      if (
        data.type === 'WEBRTC_ANSWER' &&
        data.participantId !== participantId &&
        data.answer
      ) {
        console.log(
          '[WEBRTC] ANSWER RECEIVED'
        );

        try {
          await pc.setRemoteDescription(
            new RTCSessionDescription(
              data.answer
            )
          );

          console.log(
            '[WEBRTC] Remote ANSWER applied'
          );

          await flushPendingCandidates();
        } catch (error) {
          console.error(
            '[WEBRTC] Failed processing ANSWER:',
            error
          );
        }

        return;
      }

      // ========================================================
      // RECEIVE ICE
      // ========================================================

      if (
        data.type === 'WEBRTC_ICE' &&
        data.participantId !== participantId &&
        data.candidate
      ) {
        console.log(
          '[WEBRTC] ICE CANDIDATE RECEIVED'
        );

        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(
              new RTCIceCandidate(
                data.candidate
              )
            );

            console.log(
              '[WEBRTC] ICE candidate added'
            );
          } else {
            console.log(
              '[WEBRTC] Queueing ICE candidate'
            );

            pendingCandidates.current.push(
              data.candidate
            );
          }
        } catch (error) {
          console.error(
            '[WEBRTC] Failed adding ICE candidate:',
            error
          );
        }

        return;
      }

      // ========================================================
      // PEER LEFT
      // ========================================================

      if (
        data.type === 'PEER_LEFT' &&
        data.participantId !== participantId
      ) {
        console.log(
          '[WEBRTC] PEER LEFT'
        );

        remoteParticipantId.current =
          null;

        pendingCandidates.current = [];

        offerSent.current = false;

        remoteMediaStream.current =
          null;

        setRemoteStream(null);

        return;
      }
    };

    // ==========================================================
    // PROCESS QUEUED SIGNALS
    // ==========================================================

    const processPendingSignals =
      async () => {
        if (
          pendingSignals.current.length ===
          0
        ) {
          return;
        }

        console.log(
          '[WEBRTC] Processing queued signals:',
          pendingSignals.current.length
        );

        const signals = [
          ...pendingSignals.current,
        ];

        pendingSignals.current = [];

        for (const signal of signals) {
          try {
            await processSignal(signal);
          } catch (error) {
            console.error(
              '[WEBRTC] Failed processing queued signal:',
              error
            );
          }
        }
      };

    // Process anything that arrived before
    // PeerConnection was ready.
    processPendingSignals();

    // ==========================================================
    // CLEANUP
    // ==========================================================

    return () => {
      console.log(
        '[WEBRTC] Cleaning up PeerConnection'
      );

      pendingCandidates.current = [];

      offerSent.current = false;

      makingOffer.current = false;

      remoteParticipantId.current =
        null;

      remoteMediaStream.current =
        null;

      setRemoteStream(null);

      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange =
        null;
      pc.onconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      pc.onicegatheringstatechange =
        null;
      pc.onnegotiationneeded = null;

      try {
        pc.close();
      } catch {
        // Ignore cleanup errors
      }

      if (
        peerConnection.current === pc
      ) {
        peerConnection.current = null;
      }
    };
  }, [
    ws,
    sessionId,
    participantId,
    localStream,
  ]);

  // ============================================================
  // RETURN
  // ============================================================

  return {
    localStream,
    remoteStream,
  };
}