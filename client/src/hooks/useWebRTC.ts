import { useCallback, useEffect, useRef, useState } from 'react';

interface WebRTCProps {
  ws: WebSocket | null;
  sessionId: string | undefined;
  participantId: string;
  peerParticipantId: string | null;
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

const TURN_USERNAME =
  import.meta.env.VITE_TURN_USERNAME as string | undefined;

const TURN_CREDENTIAL =
  import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

export function useWebRTC({
  ws,
  sessionId,
  participantId,
  peerParticipantId,
  cameraOn,
  micOn,
}: WebRTCProps) {
  const [localStream, setLocalStream] =
    useState<MediaStream | null>(null);

  const [remoteStream, setRemoteStream] =
    useState<MediaStream | null>(null);

  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>('new');

  const [iceConnectionState, setIceConnectionState] =
    useState<RTCIceConnectionState>('new');

  const [mediaState, setMediaState] =
    useState<'idle' | 'requesting' | 'ready' | 'error'>('idle');

  const [mediaError, setMediaError] =
    useState<string | null>(null);

  const localStreamRef =
    useRef<MediaStream | null>(null);

  const peerConnection =
    useRef<RTCPeerConnection | null>(null);

  const pendingCandidates =
    useRef<RTCIceCandidateInit[]>([]);

  const pendingSignals =
    useRef<SignalMessage[]>([]);

  const processSignalRef =
    useRef<
      ((data: SignalMessage) => Promise<void>) | null
    >(null);

  const remoteStreamRef =
    useRef<MediaStream | null>(null);

  const makingOffer =
    useRef(false);

  const offerCreated =
    useRef(false);

  const ignoreOffer =
    useRef(false);

  const restartTimer =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const restartAttempts =
    useRef(0);

  const mediaRequestRef =
    useRef(false);

  // ============================================================
  // LOCAL MEDIA
  // ============================================================
  //
  // Camera + microphone are requested explicitly by the Aarzoo UI
  // through requestMedia(). This makes the browser permission
  // prompt deliberate and easy for users to understand.
  //

  const requestMedia = useCallback(async () => {
    if (localStreamRef.current) {
      const existing = localStreamRef.current;

      existing.getVideoTracks().forEach((track) => {
        track.enabled = cameraOn;
      });

      existing.getAudioTracks().forEach((track) => {
        track.enabled = micOn;
      });

      setMediaState('ready');
      setMediaError(null);

      return existing;
    }

    if (mediaRequestRef.current) {
      return null;
    }

    mediaRequestRef.current = true;
    setMediaState('requesting');
    setMediaError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Camera and microphone access is not supported by this browser.'
        );
      }

      console.log(
        '[WEBRTC] Requesting camera + microphone from Aarzoo UI'
      );

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
          audio: true,
        });

      stream.getVideoTracks().forEach((track) => {
        track.enabled = cameraOn;
      });

      stream.getAudioTracks().forEach((track) => {
        track.enabled = micOn;
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setMediaState('ready');
      setMediaError(null);

      console.log('[WEBRTC] Local media READY', {
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length,
      });

      return stream;
    } catch (error) {
      const name =
        error instanceof DOMException
          ? error.name
          : 'UnknownError';

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      let friendly =
        'Camera and microphone access could not be started.';

      if (
        name === 'NotAllowedError' ||
        name === 'PermissionDeniedError'
      ) {
        friendly =
          'Camera or microphone permission was denied. Please allow both permissions and try again.';
      } else if (name === 'NotFoundError') {
        friendly =
          'No camera or microphone was found on this device.';
      } else if (name === 'NotReadableError') {
        friendly =
          'The camera or microphone is being used by another app.';
      } else if (name === 'SecurityError') {
        friendly =
          'The browser blocked camera or microphone access for this page.';
      }

      setMediaState('error');
      setMediaError(friendly);

      console.error('[WEBRTC] LOCAL MEDIA FAILED', {
        name,
        message,
        constraint:
          error instanceof DOMException
            ? error.constraint
            : undefined,
      });

      return null;
    } finally {
      mediaRequestRef.current = false;
    }
  }, [cameraOn, micOn]);

  useEffect(() => {
    return () => {
      const stream = localStreamRef.current;

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
    };
  }, []);

  // ============================================================
  // CAMERA / MIC
  // ============================================================

  useEffect(() => {
    if (!localStream) return;

    localStream.getVideoTracks().forEach((track) => {
      track.enabled = cameraOn;
    });

    localStream.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });
  }, [localStream, cameraOn, micOn]);

  // ============================================================
  // WEBSOCKET SIGNALING
  // ============================================================

  useEffect(() => {
    if (!ws || !sessionId) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as SignalMessage;

        if (
          data.sessionId &&
          data.sessionId !== sessionId
        ) {
          return;
        }

        if (
          data.participantId &&
          data.participantId === participantId
        ) {
          return;
        }

        if (
          data.type !== 'WEBRTC_OFFER' &&
          data.type !== 'WEBRTC_ANSWER' &&
          data.type !== 'WEBRTC_ICE' &&
          data.type !== 'PEER_LEFT' &&
          data.type !== 'SESSION_ENDED'
        ) {
          return;
        }

        console.log(
          '[WEBRTC] SIGNAL RECEIVED:',
          data.type
        );

        if (processSignalRef.current) {
          void processSignalRef.current(data);
        } else {
          pendingSignals.current.push(data);
        }
      } catch (error) {
        console.error(
          '[WEBRTC] Failed to parse signaling message:',
          error
        );
      }
    };

    ws.addEventListener('message', handleMessage);

    return () => {
      ws.removeEventListener('message', handleMessage);
    };
  }, [ws, sessionId, participantId]);

  // ============================================================
  // PEER CONNECTION
  // ============================================================

  useEffect(() => {
    if (
      !ws ||
      !sessionId ||
      !localStream ||
      !peerParticipantId
    ) {
      return;
    }

    console.log(
      '[WEBRTC] Starting connection:',
      peerParticipantId
    );

    const iceServers: RTCIceServer[] = [
      {
        urls: 'stun:stun.relay.metered.ca:80',
      },
    ];

    if (TURN_USERNAME && TURN_CREDENTIAL) {
      iceServers.push({
        urls: [
          'turn:global.relay.metered.ca:80',
          'turn:global.relay.metered.ca:80?transport=tcp',
          'turn:global.relay.metered.ca:443',
          'turns:global.relay.metered.ca:443?transport=tcp',
        ],
        username: TURN_USERNAME,
        credential: TURN_CREDENTIAL,
      });
    } else {
      console.warn(
        '[WEBRTC] TURN credentials missing; continuing with STUN/direct ICE.'
      );
    }

    const pc = new RTCPeerConnection({
      // Direct P2P when possible; TURN is the fallback.
      iceTransportPolicy: 'all',
      iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    peerConnection.current = pc;
    localStreamRef.current = localStream;

    pendingCandidates.current = [];
    remoteStreamRef.current = null;

    makingOffer.current = false;
    offerCreated.current = false;
    ignoreOffer.current = false;
    restartAttempts.current = 0;

    setRemoteStream(null);
    setConnectionState('new');
    setIceConnectionState('new');

    const isInitiator =
      participantId < peerParticipantId;

    const isPolite =
      participantId > peerParticipantId;

    console.log(
      '[WEBRTC] PeerConnection created:',
      {
        local: participantId,
        remote: peerParticipantId,
        isInitiator,
        isPolite,
      }
    );

    // ==========================================================
    // SEND SIGNAL
    // ==========================================================

    const sendSignal = (
      message: SignalMessage
    ) => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.error(
          '[WEBRTC] WebSocket not open'
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
    // LOCAL TRACKS
    // ==========================================================

    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);

      console.log(
        '[WEBRTC] Added local track:',
        track.kind
      );
    });

    // ==========================================================
    // REMOTE TRACK
    // ==========================================================

    pc.ontrack = (event) => {
      console.log(
        '[WEBRTC] REMOTE TRACK RECEIVED:',
        event.track.kind
      );

      if (event.streams?.[0]) {
        remoteStreamRef.current =
          event.streams[0];

        setRemoteStream(
          event.streams[0]
        );

        return;
      }

      if (!remoteStreamRef.current) {
        remoteStreamRef.current =
          new MediaStream();
      }

      if (
        !remoteStreamRef.current
          .getTracks()
          .some(
            (track) =>
              track.id === event.track.id
          )
      ) {
        remoteStreamRef.current.addTrack(
          event.track
        );
      }

      setRemoteStream(
        remoteStreamRef.current
      );
    };

    // ==========================================================
    // ICE
    // ==========================================================

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        console.log(
          '[WEBRTC] ICE gathering complete'
        );

        return;
      }

      console.log(
        '[WEBRTC] LOCAL ICE:',
        {
          type: event.candidate.type,
          protocol: event.candidate.protocol,
        }
      );

      sendSignal({
        type: 'WEBRTC_ICE',
        sessionId,
        participantId,
        candidate:
          event.candidate.toJSON(),
      });
    };

    pc.onicecandidateerror = (event) => {
      console.warn(
        '[WEBRTC] ICE CANDIDATE ERROR:',
        {
          code: event.errorCode,
          text: event.errorText,
          url: event.url,
        }
      );
    };

    // ==========================================================
    // ICE STATE
    // ==========================================================

    pc.oniceconnectionstatechange = () => {
      console.log(
        '[WEBRTC] ICE STATE:',
        pc.iceConnectionState
      );

      setIceConnectionState(
        pc.iceConnectionState
      );

      if (
        pc.iceConnectionState ===
        'connected' ||
        pc.iceConnectionState ===
        'completed'
      ) {
        restartAttempts.current = 0;
      }

      if (
        pc.iceConnectionState ===
        'failed' ||
        pc.iceConnectionState ===
        'disconnected'
      ) {
        /*
         * Mobile networks can temporarily change route.
         *
         * Give the network a little time before restarting.
         */
        if (!restartTimer.current) {
          restartTimer.current =
            setTimeout(async () => {
              restartTimer.current = null;

              if (
                pc.signalingState !==
                'closed'
              ) {
                console.log(
                  '[WEBRTC] Attempting ICE restart'
                );

                try {
                  restartAttempts.current += 1;

                  const offer =
                    await pc.createOffer({
                      iceRestart: true,
                    });

                  await pc.setLocalDescription(
                    offer
                  );

                  if (
                    pc.localDescription
                  ) {
                    sendSignal({
                      type:
                        'WEBRTC_OFFER',
                      sessionId,
                      participantId,
                      offer:
                        pc.localDescription.toJSON(),
                    });
                  }
                } catch (error) {
                  console.error(
                    '[WEBRTC] ICE restart failed:',
                    error
                  );
                }
              }
            }, 1500);
        }
      }
    };

    // ==========================================================
    // CONNECTION STATE
    // ==========================================================

    pc.onconnectionstatechange = () => {
      console.log(
        '[WEBRTC] CONNECTION STATE:',
        pc.connectionState
      );

      setConnectionState(
        pc.connectionState
      );
    };

    pc.onsignalingstatechange = () => {
      console.log(
        '[WEBRTC] SIGNALING STATE:',
        pc.signalingState
      );
    };

    pc.onicegatheringstatechange = () => {
      console.log(
        '[WEBRTC] ICE GATHERING:',
        pc.iceGatheringState
      );
    };

    // ==========================================================
    // FLUSH ICE
    // ==========================================================

    const flushCandidates = async () => {
      if (!pc.remoteDescription) {
        return;
      }

      const queued =
        pendingCandidates.current.splice(
          0
        );

      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(
            candidate
          );
        } catch (error) {
          console.error(
            '[WEBRTC] Failed queued ICE:',
            error
          );
        }
      }
    };

    // ==========================================================
    // CREATE OFFER
    // ==========================================================

    const createOffer = async (
      iceRestart = false
    ) => {
      if (!isInitiator && !iceRestart) {
        return;
      }

      if (makingOffer.current) {
        return;
      }

      if (
        pc.signalingState !==
        'stable'
      ) {
        return;
      }

      try {
        makingOffer.current = true;

        console.log(
          '[WEBRTC] CREATING OFFER',
          { iceRestart }
        );

        const offer =
          await pc.createOffer(
            iceRestart
              ? { iceRestart: true }
              : undefined
          );

        await pc.setLocalDescription(
          offer
        );

        if (!pc.localDescription) {
          return;
        }

        const sent =
          sendSignal({
            type: 'WEBRTC_OFFER',
            sessionId,
            participantId,
            offer:
              pc.localDescription.toJSON(),
          });

        if (sent) {
          offerCreated.current =
            true;

          console.log(
            '[WEBRTC] OFFER SENT'
          );
        }
      } catch (error) {
        console.error(
          '[WEBRTC] OFFER FAILED:',
          error
        );
      } finally {
        makingOffer.current = false;
      }
    };

    // ==========================================================
    // SIGNAL PROCESSOR
    // ==========================================================

    const processSignal = async (
      data: SignalMessage
    ) => {
      // --------------------------------------------------------
      // SESSION ENDED
      // --------------------------------------------------------

      if (
        data.type ===
        'SESSION_ENDED'
      ) {
        console.log(
          '[WEBRTC] SESSION ENDED'
        );

        return;
      }

      // --------------------------------------------------------
      // PEER LEFT
      // --------------------------------------------------------

      if (
        data.type ===
        'PEER_LEFT'
      ) {
        console.log(
          '[WEBRTC] PEER LEFT'
        );

        pendingCandidates.current = [];
        pendingSignals.current = [];

        return;
      }

      // --------------------------------------------------------
      // OFFER
      // --------------------------------------------------------

      if (
        data.type ===
        'WEBRTC_OFFER' &&
        data.offer
      ) {
        console.log(
          '[WEBRTC] PROCESSING OFFER'
        );

        const offerCollision =
          makingOffer.current ||
          pc.signalingState !==
          'stable';

        if (
          offerCollision &&
          !isPolite
        ) {
          console.log(
            '[WEBRTC] Ignoring offer collision'
          );

          ignoreOffer.current = true;

          return;
        }

        try {
          ignoreOffer.current = false;

          if (
            isPolite &&
            pc.signalingState ===
            'have-local-offer'
          ) {
            await pc.setLocalDescription({
              type: 'rollback',
            });
          }

          await pc.setRemoteDescription(
            new RTCSessionDescription(
              data.offer
            )
          );

          await flushCandidates();

          const answer =
            await pc.createAnswer();

          await pc.setLocalDescription(
            answer
          );

          if (!pc.localDescription) {
            return;
          }

          sendSignal({
            type: 'WEBRTC_ANSWER',
            sessionId,
            participantId,
            answer:
              pc.localDescription.toJSON(),
          });

          console.log(
            '[WEBRTC] ANSWER SENT'
          );
        } catch (error) {
          console.error(
            '[WEBRTC] OFFER PROCESSING FAILED:',
            error
          );
        }

        return;
      }

      // --------------------------------------------------------
      // ANSWER
      // --------------------------------------------------------

      if (
        data.type ===
        'WEBRTC_ANSWER' &&
        data.answer
      ) {
        if (
          pc.signalingState !==
          'have-local-offer'
        ) {
          console.warn(
            '[WEBRTC] Ignoring unexpected ANSWER:',
            pc.signalingState
          );

          return;
        }

        try {
          await pc.setRemoteDescription(
            new RTCSessionDescription(
              data.answer
            )
          );

          await flushCandidates();

          console.log(
            '[WEBRTC] ANSWER APPLIED'
          );
        } catch (error) {
          console.error(
            '[WEBRTC] ANSWER FAILED:',
            error
          );
        }

        return;
      }

      // --------------------------------------------------------
      // ICE
      // --------------------------------------------------------

      if (
        data.type ===
        'WEBRTC_ICE' &&
        data.candidate
      ) {
        if (ignoreOffer.current) {
          return;
        }

        try {
          if (
            pc.remoteDescription
          ) {
            await pc.addIceCandidate(
              data.candidate
            );
          } else {
            pendingCandidates.current.push(
              data.candidate
            );
          }
        } catch (error) {
          console.error(
            '[WEBRTC] ICE FAILED:',
            error
          );
        }
      }
    };

    // ==========================================================
    // REGISTER PROCESSOR
    // ==========================================================

    processSignalRef.current =
      processSignal;

    // ==========================================================
    // PROCESS QUEUED SIGNALS
    // ==========================================================

    const queuedSignals =
      pendingSignals.current.splice(
        0
      );

    void (async () => {
      for (
        const signal of queuedSignals
      ) {
        await processSignal(
          signal
        );
      }
    })();

    // ==========================================================
    // START CALL
    // ==========================================================

    if (isInitiator) {
      setTimeout(() => {
        void createOffer(false);
      }, 100);
    }

    // ==========================================================
    // CLEANUP
    // ==========================================================

    return () => {
      console.log(
        '[WEBRTC] Cleaning up'
      );

      if (
        restartTimer.current
      ) {
        clearTimeout(
          restartTimer.current
        );

        restartTimer.current =
          null;
      }

      if (
        processSignalRef.current ===
        processSignal
      ) {
        processSignalRef.current =
          null;
      }

      pendingCandidates.current =
        [];

      pendingSignals.current =
        [];

      makingOffer.current =
        false;

      offerCreated.current =
        false;

      ignoreOffer.current =
        false;

      remoteStreamRef.current =
        null;

      setRemoteStream(null);

      try {
        pc.close();
      } catch {
        // Ignore cleanup error.
      }

      if (
        peerConnection.current ===
        pc
      ) {
        peerConnection.current =
          null;
      }
    };
  }, [
    ws,
    sessionId,
    participantId,
    peerParticipantId,
    localStream,
  ]);

  return {
    localStream,
    remoteStream,
    connectionState,
    iceConnectionState,
    mediaState,
    mediaError,
    requestMedia,
  };
}