import { useEffect, useRef, useState } from 'react';

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
  // ============================================================
  // STATE
  // ============================================================

  const [localStream, setLocalStream] =
    useState<MediaStream | null>(null);

  const [remoteStream, setRemoteStream] =
    useState<MediaStream | null>(null);

  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>('new');

  const [iceConnectionState, setIceConnectionState] =
    useState<RTCIceConnectionState>('new');

  // ============================================================
  // REFS
  // ============================================================

  const peerConnection =
    useRef<RTCPeerConnection | null>(null);

  const pendingCandidates =
    useRef<RTCIceCandidateInit[]>([]);

  /*
   * Signals that arrive before the PeerConnection exists.
   */
  const pendingSignals =
    useRef<SignalMessage[]>([]);

  /*
   * IMPORTANT FIX:
   *
   * The signaling listener exists independently from the
   * PeerConnection effect.
   *
   * Once the PeerConnection exists, this ref points to the
   * actual signal processor.
   */
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

  const peerIdRef =
    useRef<string | null>(peerParticipantId);

  // Keep latest peer ID available.
  useEffect(() => {
    peerIdRef.current = peerParticipantId;
  }, [peerParticipantId]);

  // ============================================================
  // LOCAL CAMERA + MICROPHONE
  // ============================================================

  useEffect(() => {
    let mounted = true;
    let stream: MediaStream | null = null;

    const startMedia = async () => {
      try {
        console.log(
          '[WEBRTC] Requesting camera + microphone'
        );

        stream =
          await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640 },
              height: { ideal: 480 },
              facingMode: 'user',
            },
            audio: true,
          });

        if (!mounted) {
          stream
            .getTracks()
            .forEach((track) => track.stop());

          return;
        }

        stream
          .getVideoTracks()
          .forEach(
            (track) => {
              track.enabled = cameraOn;
            }
          );

        stream
          .getAudioTracks()
          .forEach(
            (track) => {
              track.enabled = micOn;
            }
          );

        setLocalStream(stream);

        console.log(
          '[WEBRTC] Local media ready',
          {
            videoTracks:
              stream.getVideoTracks().length,
            audioTracks:
              stream.getAudioTracks().length,
          }
        );
      } catch (error) {
        console.error(
          '[WEBRTC] getUserMedia failed:',
          error
        );
      }
    };

    void startMedia();

    return () => {
      mounted = false;

      if (stream) {
        stream
          .getTracks()
          .forEach((track) => track.stop());
      }
    };
  }, []);

  // ============================================================
  // CAMERA / MICROPHONE ENABLE / DISABLE
  // ============================================================

  useEffect(() => {
    if (!localStream) {
      return;
    }

    localStream
      .getVideoTracks()
      .forEach(
        (track) => {
          track.enabled = cameraOn;
        }
      );

    localStream
      .getAudioTracks()
      .forEach(
        (track) => {
          track.enabled = micOn;
        }
      );
  }, [
    localStream,
    cameraOn,
    micOn,
  ]);

  // ============================================================
  // SIGNALING LISTENER
  //
  // IMPORTANT:
  //
  // This listener is created as soon as the WebSocket exists.
  //
  // If PeerConnection already exists:
  //     process signal immediately
  //
  // If PeerConnection doesn't exist:
  //     queue signal
  //
  // This fixes the original bug.
  // ============================================================

  useEffect(() => {
    if (!ws || !sessionId) {
      return;
    }

    const handleMessage = (
      event: MessageEvent
    ) => {
      try {
        const data =
          JSON.parse(
            event.data
          ) as SignalMessage;

        // ------------------------------------------------------
        // SESSION FILTER
        // ------------------------------------------------------

        if (
          data.sessionId &&
          data.sessionId !== sessionId
        ) {
          return;
        }

        // ------------------------------------------------------
        // IGNORE OUR OWN SIGNALS
        // ------------------------------------------------------

        if (
          data.participantId &&
          data.participantId === participantId
        ) {
          return;
        }

        // ------------------------------------------------------
        // ONLY WEBRTC SIGNALS
        // ------------------------------------------------------

        if (
          data.type !== 'WEBRTC_OFFER' &&
          data.type !== 'WEBRTC_ANSWER' &&
          data.type !== 'WEBRTC_ICE' &&
          data.type !== 'PEER_LEFT'
        ) {
          return;
        }

        console.log(
          '[WEBRTC] SIGNAL RECEIVED:',
          data.type
        );

        // ======================================================
        // IMPORTANT FIX
        // ======================================================

        /*
         * If the PeerConnection already exists, process the
         * signal immediately.
         */

        if (processSignalRef.current) {
          console.log(
            '[WEBRTC] Processing signal immediately:',
            data.type
          );

          void processSignalRef.current(data);

          return;
        }

        /*
         * Otherwise queue it.
         *
         * This can happen when OFFER arrives before the local
         * media / PeerConnection has finished initializing.
         */

        console.log(
          '[WEBRTC] PeerConnection not ready. Queueing:',
          data.type
        );

        pendingSignals.current.push(data);
      } catch (error) {
        console.error(
          '[WEBRTC] Failed to parse signaling message:',
          error
        );
      }
    };

    ws.addEventListener(
      'message',
      handleMessage
    );

    return () => {
      ws.removeEventListener(
        'message',
        handleMessage
      );
    };
  }, [
    ws,
    sessionId,
    participantId,
  ]);

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
      '[WEBRTC] Starting WebRTC because peer exists:',
      peerParticipantId
    );

    // ==========================================================
    // CHECK TURN CREDENTIALS
    // ==========================================================

    if (
      !TURN_USERNAME ||
      !TURN_CREDENTIAL
    ) {
      console.error(
        '[WEBRTC] TURN credentials are missing.'
      );

      console.error(
        '[WEBRTC] Required environment variables:',
        {
          VITE_TURN_USERNAME:
            Boolean(TURN_USERNAME),
          VITE_TURN_CREDENTIAL:
            Boolean(TURN_CREDENTIAL),
        }
      );

      return;
    }

    // ==========================================================
    // CREATE PEER CONNECTION
    // ==========================================================

    const pc =
      new RTCPeerConnection({
        /*
         * TURN ONLY.
         *
         * This intentionally prevents direct peer-to-peer
         * candidate selection, including same-WiFi connections.
         */
        iceTransportPolicy: 'relay',

        iceServers: [
          {
            urls: [
              'turn:global.relay.metered.ca:80',
              'turn:global.relay.metered.ca:80?transport=tcp',
              'turn:global.relay.metered.ca:443',
              'turns:global.relay.metered.ca:443?transport=tcp',
            ],
            username: TURN_USERNAME,
            credential: TURN_CREDENTIAL,
          },
        ],
      });

    peerConnection.current = pc;

    // Reset state for this connection.
    pendingCandidates.current = [];

    remoteStreamRef.current = null;

    makingOffer.current = false;

    offerCreated.current = false;

    ignoreOffer.current = false;

    setRemoteStream(null);

    setConnectionState(
      'new'
    );

    setIceConnectionState(
      'new'
    );

    // ==========================================================
    // DETERMINISTIC INITIATOR
    //
    // Smaller participant ID creates the offer.
    //
    // Larger participant ID answers.
    // ==========================================================

    const isInitiator =
      participantId <
      peerParticipantId;

    /*
     * Polite peer is the larger ID.
     *
     * If simultaneous offers happen, polite peer rolls back.
     */

    const isPolite =
      participantId >
      peerParticipantId;

    console.log(
      '[WEBRTC] PeerConnection created:',
      {
        local: participantId,
        remote: peerParticipantId,
        isInitiator,
        isPolite,
        iceTransportPolicy: 'relay',
      }
    );

    // ==========================================================
    // SIGNAL SENDER
    // ==========================================================

    const sendSignal = (
      message: SignalMessage
    ) => {
      if (
        ws.readyState !==
        WebSocket.OPEN
      ) {
        console.error(
          '[WEBRTC] Cannot send signal. WebSocket state:',
          ws.readyState
        );

        return false;
      }

      try {
        ws.send(
          JSON.stringify(message)
        );

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
    // ADD LOCAL TRACKS
    // ==========================================================

    localStream
      .getTracks()
      .forEach((track) => {
        pc.addTrack(
          track,
          localStream
        );

        console.log(
          '[WEBRTC] Added local track:',
          {
            kind: track.kind,
            id: track.id,
            enabled: track.enabled,
          }
        );
      });

    // ==========================================================
    // REMOTE TRACK
    // ==========================================================

    pc.ontrack = (
      event
    ) => {
      console.log(
        '[WEBRTC] REMOTE TRACK RECEIVED:',
        {
          kind: event.track.kind,
          id: event.track.id,
          streams:
            event.streams.length,
        }
      );

      // --------------------------------------------------------
      // Normal case: browser gives us a MediaStream.
      // --------------------------------------------------------

      if (
        event.streams &&
        event.streams[0]
      ) {
        remoteStreamRef.current =
          event.streams[0];

        setRemoteStream(
          event.streams[0]
        );

        console.log(
          '[WEBRTC] Remote stream attached:',
          {
            videoTracks:
              event.streams[0]
                .getVideoTracks()
                .length,
            audioTracks:
              event.streams[0]
                .getAudioTracks()
                .length,
          }
        );

        return;
      }

      // --------------------------------------------------------
      // Fallback: construct our own MediaStream.
      // --------------------------------------------------------

      if (
        !remoteStreamRef.current
      ) {
        remoteStreamRef.current =
          new MediaStream();
      }

      const alreadyAdded =
        remoteStreamRef.current
          .getTracks()
          .some(
            (track) =>
              track.id ===
              event.track.id
          );

      if (!alreadyAdded) {
        remoteStreamRef.current.addTrack(
          event.track
        );
      }

      setRemoteStream(
        remoteStreamRef.current
      );
    };

    // ==========================================================
    // ICE CANDIDATES
    // ==========================================================

    pc.onicecandidate = (
      event
    ) => {
      if (!event.candidate) {
        console.log(
          '[WEBRTC] ICE gathering finished'
        );

        return;
      }

      console.log(
        '[WEBRTC] Local ICE candidate:',
        {
          type:
            event.candidate.type,
          protocol:
            event.candidate.protocol,
          address:
            event.candidate.address,
          port:
            event.candidate.port,
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

    // ==========================================================
    // ICE CANDIDATE ERROR
    // ==========================================================

    pc.onicecandidateerror = (
      event
    ) => {
      console.error(
        '[WEBRTC] ICE candidate error:',
        {
          code:
            event.errorCode,
          text:
            event.errorText,
          url:
            event.url,
        }
      );
    };

    // ==========================================================
    // ICE CONNECTION STATE
    // ==========================================================

    pc.oniceconnectionstatechange =
      () => {
        console.log(
          '[WEBRTC] ICE STATE:',
          pc.iceConnectionState
        );

        setIceConnectionState(
          pc.iceConnectionState
        );
      };

    // ==========================================================
    // PEER CONNECTION STATE
    // ==========================================================

    pc.onconnectionstatechange =
      () => {
        console.log(
          '[WEBRTC] CONNECTION STATE:',
          pc.connectionState
        );

        setConnectionState(
          pc.connectionState
        );
      };

    // ==========================================================
    // SIGNALING STATE
    // ==========================================================

    pc.onsignalingstatechange =
      () => {
        console.log(
          '[WEBRTC] SIGNALING STATE:',
          pc.signalingState
        );
      };

    // ==========================================================
    // ICE GATHERING STATE
    // ==========================================================

    pc.onicegatheringstatechange =
      () => {
        console.log(
          '[WEBRTC] ICE GATHERING:',
          pc.iceGatheringState
        );
      };

    // ==========================================================
    // FLUSH QUEUED ICE CANDIDATES
    // ==========================================================

    const flushCandidates =
      async () => {
        if (
          !pc.remoteDescription
        ) {
          return;
        }

        const queued =
          pendingCandidates.current.splice(
            0
          );

        if (queued.length === 0) {
          return;
        }

        console.log(
          '[WEBRTC] Flushing queued ICE:',
          queued.length
        );

        for (
          const candidate of queued
        ) {
          try {
            await pc.addIceCandidate(
              candidate
            );

            console.log(
              '[WEBRTC] Queued ICE candidate added'
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
    // CREATE INITIAL OFFER
    // ==========================================================

    const createInitialOffer =
      async () => {
        if (!isInitiator) {
          console.log(
            '[WEBRTC] This participant is the answerer.'
          );

          return;
        }

        if (
          offerCreated.current
        ) {
          console.log(
            '[WEBRTC] Offer already created.'
          );

          return;
        }

        if (
          makingOffer.current
        ) {
          console.log(
            '[WEBRTC] Offer creation already in progress.'
          );

          return;
        }

        if (
          pc.signalingState !==
          'stable'
        ) {
          console.log(
            '[WEBRTC] Cannot create offer. Signaling state:',
            pc.signalingState
          );

          return;
        }

        try {
          makingOffer.current =
            true;

          console.log(
            '[WEBRTC] ⭐ CREATING INITIAL OFFER'
          );

          const offer =
            await pc.createOffer();

          await pc.setLocalDescription(
            offer
          );

          if (
            !pc.localDescription
          ) {
            throw new Error(
              'Local description was not created'
            );
          }

          const sent =
            sendSignal({
              type:
                'WEBRTC_OFFER',
              sessionId,
              participantId,
              offer:
                pc.localDescription.toJSON(),
            });

          if (sent) {
            offerCreated.current =
              true;

            console.log(
              '[WEBRTC] ⭐ OFFER SENT SUCCESSFULLY'
            );
          }
        } catch (error) {
          console.error(
            '[WEBRTC] OFFER CREATION FAILED:',
            error
          );
        } finally {
          makingOffer.current =
            false;
        }
      };

    // ==========================================================
    // PROCESS SIGNAL
    //
    // THIS FUNCTION IS NOW STORED IN processSignalRef.
    //
    // That is the main fix.
    //
    // The WebSocket listener can call it immediately when the
    // PeerConnection exists.
    // ==========================================================

    const processSignal =
      async (
        data: SignalMessage
      ) => {
        // ======================================================
        // OFFER
        // ======================================================

        if (
          data.type ===
          'WEBRTC_OFFER' &&
          data.offer
        ) {
          console.log(
            '[WEBRTC] Processing OFFER from:',
            data.participantId
          );

          const offerCollision =
            makingOffer.current ||
            pc.signalingState !==
            'stable';

          if (
            offerCollision &&
            !isPolite
          ) {
            console.warn(
              '[WEBRTC] Ignoring offer collision because peer is impolite.'
            );

            ignoreOffer.current =
              true;

            return;
          }

          try {
            ignoreOffer.current =
              false;

            // --------------------------------------------------
            // Rollback if polite peer has an existing offer.
            // --------------------------------------------------

            if (
              isPolite &&
              pc.signalingState ===
              'have-local-offer'
            ) {
              console.log(
                '[WEBRTC] Rolling back local offer'
              );

              await pc.setLocalDescription({
                type:
                  'rollback',
              });
            }

            // --------------------------------------------------
            // Apply remote offer.
            // --------------------------------------------------

            await pc.setRemoteDescription(
              new RTCSessionDescription(
                data.offer
              )
            );

            console.log(
              '[WEBRTC] Remote OFFER applied'
            );

            // --------------------------------------------------
            // Add any ICE candidates that arrived with/before
            // the offer.
            // --------------------------------------------------

            await flushCandidates();

            // --------------------------------------------------
            // Create answer.
            // --------------------------------------------------

            const answer =
              await pc.createAnswer();

            await pc.setLocalDescription(
              answer
            );

            if (
              !pc.localDescription
            ) {
              throw new Error(
                'Local answer missing'
              );
            }

            // --------------------------------------------------
            // Send answer.
            // --------------------------------------------------

            const sent =
              sendSignal({
                type:
                  'WEBRTC_ANSWER',
                sessionId,
                participantId,
                answer:
                  pc.localDescription.toJSON(),
              });

            if (sent) {
              console.log(
                '[WEBRTC] ⭐ ANSWER SENT'
              );
            }
          } catch (error) {
            console.error(
              '[WEBRTC] OFFER PROCESSING FAILED:',
              error
            );
          }

          return;
        }

        // ======================================================
        // ANSWER
        // ======================================================

        if (
          data.type ===
          'WEBRTC_ANSWER' &&
          data.answer
        ) {
          console.log(
            '[WEBRTC] Processing ANSWER from:',
            data.participantId
          );

          try {
            /*
             * Only apply an answer when we have a local offer.
             */

            if (
              pc.signalingState !==
              'have-local-offer'
            ) {
              console.warn(
                '[WEBRTC] Ignoring ANSWER because signaling state is:',
                pc.signalingState
              );

              return;
            }

            await pc.setRemoteDescription(
              new RTCSessionDescription(
                data.answer
              )
            );

            console.log(
              '[WEBRTC] ⭐ REMOTE ANSWER APPLIED'
            );

            await flushCandidates();
          } catch (error) {
            console.error(
              '[WEBRTC] ANSWER PROCESSING FAILED:',
              error
            );
          }

          return;
        }

        // ======================================================
        // ICE
        // ======================================================

        if (
          data.type ===
          'WEBRTC_ICE' &&
          data.candidate
        ) {
          if (
            ignoreOffer.current
          ) {
            return;
          }

          try {
            /*
             * If remote SDP is already applied, add ICE
             * immediately.
             */

            if (
              pc.remoteDescription
            ) {
              await pc.addIceCandidate(
                data.candidate
              );

              console.log(
                '[WEBRTC] Remote ICE candidate added'
              );
            } else {
              /*
               * Otherwise wait until remote SDP exists.
               */

              pendingCandidates.current.push(
                data.candidate
              );

              console.log(
                '[WEBRTC] ICE queued until remote description'
              );
            }
          } catch (error) {
            console.error(
              '[WEBRTC] ICE PROCESSING FAILED:',
              error
            );
          }

          return;
        }

        // ======================================================
        // PEER LEFT
        // ======================================================

        if (
          data.type ===
          'PEER_LEFT'
        ) {
          console.log(
            '[WEBRTC] Peer left'
          );

          pendingCandidates.current =
            [];

          pendingSignals.current =
            [];

          remoteStreamRef.current =
            null;

          setRemoteStream(
            null
          );

          return;
        }
      };

    // ==========================================================
    // REGISTER SIGNAL PROCESSOR
    //
    // THIS IS THE CRITICAL FIX.
    // ==========================================================

    processSignalRef.current =
      processSignal;

    // ==========================================================
    // PROCESS SIGNALS THAT ARRIVED BEFORE PC EXISTED
    // ==========================================================

    const queuedSignals =
      pendingSignals.current.splice(
        0
      );

    console.log(
      '[WEBRTC] Processing queued signals:',
      queuedSignals.length
    );

    void (async () => {
      for (
        const signal of queuedSignals
      ) {
        /*
         * Process sequentially.
         *
         * This is important for:
         *
         * OFFER
         *     ↓
         * ANSWER
         *     ↓
         * ICE
         */

        await processSignal(
          signal
        );
      }
    })();

    // ==========================================================
    // START CALL
    //
    // Give the PeerConnection one event-loop tick so that
    // local tracks are fully registered before creating offer.
    // ==========================================================

    if (isInitiator) {
      setTimeout(() => {
        void createInitialOffer();
      }, 0);
    }

    // ==========================================================
    // CLEANUP
    // ==========================================================

    return () => {
      console.log(
        '[WEBRTC] Cleaning up PeerConnection'
      );

      /*
       * Only clear processSignalRef if it still points to
       * THIS PeerConnection's processor.
       */

      if (
        processSignalRef.current ===
        processSignal
      ) {
        processSignalRef.current =
          null;
      }

      pendingCandidates.current =
        [];

      makingOffer.current =
        false;

      offerCreated.current =
        false;

      ignoreOffer.current =
        false;

      remoteStreamRef.current =
        null;

      setRemoteStream(
        null
      );

      try {
        pc.close();
      } catch {
        // Ignore cleanup errors.
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

  // ============================================================
  // RETURN
  // ============================================================

  return {
    localStream,
    remoteStream,
    connectionState,
    iceConnectionState,
  };
}