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

const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME as string | undefined;
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

export function useWebRTC({
  ws,
  sessionId,
  participantId,
  peerParticipantId,
  cameraOn,
  micOn,
}: WebRTCProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>('new');
  const [iceConnectionState, setIceConnectionState] =
    useState<RTCIceConnectionState>('new');

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);

  // ------------------------------------------------------------
  // LOCAL MEDIA
  // ------------------------------------------------------------

  useEffect(() => {
    let mounted = true;
    let stream: MediaStream | null = null;

    const startMedia = async () => {
      try {
        console.log('[WEBRTC] Requesting local media');

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

        setLocalStream(stream);
        console.log('[WEBRTC] Local media ready');
      } catch (error) {
        console.error('[WEBRTC] getUserMedia failed:', error);
      }
    };

    void startMedia();

    return () => {
      mounted = false;

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!localStream) return;

    localStream.getVideoTracks().forEach((track) => {
      track.enabled = cameraOn;
    });

    localStream.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });
  }, [localStream, cameraOn, micOn]);

  // ------------------------------------------------------------
  // WEBRTC
  //
  // The peer must be known before creating the connection.
  // This removes the old PEER_JOINED timing race.
  // ------------------------------------------------------------

  useEffect(() => {
    if (!ws || !sessionId || !localStream || !peerParticipantId) {
      return;
    }

    if (!TURN_USERNAME || !TURN_CREDENTIAL) {
      console.error(
        '[WEBRTC] Missing VITE_TURN_USERNAME or VITE_TURN_CREDENTIAL'
      );
      return;
    }

    const pc = new RTCPeerConnection({
      // IMPORTANT:
      // Only TURN relay candidates are allowed.
      // Same-WiFi/direct candidates will not be selected.
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
    pendingCandidates.current = [];
    remoteStreamRef.current = null;
    makingOffer.current = false;
    ignoreOffer.current = false;

    const isPolite = participantId > peerParticipantId;

    console.log('[WEBRTC] PeerConnection created', {
      local: participantId,
      remote: peerParticipantId,
      isPolite,
      iceTransportPolicy: 'relay',
    });

    const sendSignal = (message: SignalMessage) => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn('[WEBRTC] WebSocket not open');
        return false;
      }

      try {
        ws.send(JSON.stringify(message));
        console.log('[WEBRTC] SENT:', message.type);
        return true;
      } catch (error) {
        console.error('[WEBRTC] Signaling send failed:', error);
        return false;
      }
    };

    const flushCandidates = async () => {
      if (!pc.remoteDescription) return;

      const queued = pendingCandidates.current.splice(0);

      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          if (!ignoreOffer.current) {
            console.error('[WEBRTC] Queued ICE failed:', error);
          }
        }
      }
    };

    // ----------------------------------------------------------
    // LOCAL TRACKS
    // ----------------------------------------------------------

    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    // ----------------------------------------------------------
    // REMOTE TRACKS
    // ----------------------------------------------------------

    pc.ontrack = (event) => {
      console.log('[WEBRTC] REMOTE TRACK:', {
        kind: event.track.kind,
        id: event.track.id,
      });

      if (event.streams?.[0]) {
        remoteStreamRef.current = event.streams[0];
        setRemoteStream(event.streams[0]);
        return;
      }

      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }

      if (
        !remoteStreamRef.current
          .getTracks()
          .some((track) => track.id === event.track.id)
      ) {
        remoteStreamRef.current.addTrack(event.track);
      }

      setRemoteStream(remoteStreamRef.current);
    };

    // ----------------------------------------------------------
    // OFFER / ANSWER
    // ----------------------------------------------------------

    pc.onnegotiationneeded = async () => {
      // Only the lower participant ID starts the initial call.
      if (participantId > peerParticipantId) {
        return;
      }

      if (makingOffer.current) return;
      if (pc.signalingState !== 'stable') return;

      try {
        makingOffer.current = true;

        console.log('[WEBRTC] Creating OFFER');

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (!pc.localDescription) return;

        sendSignal({
          type: 'WEBRTC_OFFER',
          sessionId,
          participantId,
          offer: pc.localDescription.toJSON(),
        });

        console.log('[WEBRTC] OFFER SENT');
      } catch (error) {
        console.error('[WEBRTC] Offer creation failed:', error);
      } finally {
        makingOffer.current = false;
      }
    };

    // ----------------------------------------------------------
    // ICE
    // ----------------------------------------------------------

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;

      sendSignal({
        type: 'WEBRTC_ICE',
        sessionId,
        participantId,
        candidate: candidate.toJSON(),
      });
    };

    pc.onicecandidateerror = (event) => {
      console.error('[WEBRTC] ICE candidate error:', {
        code: event.errorCode,
        text: event.errorText,
        url: event.url,
      });
    };

    // ----------------------------------------------------------
    // STATES
    // ----------------------------------------------------------

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      console.log('[WEBRTC] CONNECTION:', pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      setIceConnectionState(pc.iceConnectionState);
      console.log('[WEBRTC] ICE:', pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
      console.log('[WEBRTC] SIGNALING:', pc.signalingState);
    };

    pc.onicegatheringstatechange = () => {
      console.log('[WEBRTC] ICE GATHERING:', pc.iceGatheringState);
    };

    // ----------------------------------------------------------
    // SIGNALING MESSAGE HANDLER
    // ----------------------------------------------------------

    const handleMessage = async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as SignalMessage;

        if (data.sessionId && data.sessionId !== sessionId) {
          return;
        }

        if (data.participantId === participantId) {
          return;
        }

        if (data.type === 'WEBRTC_OFFER' && data.offer) {
          const readyForOffer =
            !makingOffer.current &&
            (pc.signalingState === 'stable' ||
              pc.signalingState === 'have-local-offer');

          const offerCollision =
            !readyForOffer || pc.signalingState !== 'stable';

          ignoreOffer.current =
            !isPolite && offerCollision;

          if (ignoreOffer.current) {
            console.warn('[WEBRTC] Ignoring offer collision');
            return;
          }

          try {
            if (
              isPolite &&
              pc.signalingState === 'have-local-offer'
            ) {
              await pc.setLocalDescription({
                type: 'rollback',
              });
            }

            await pc.setRemoteDescription(
              new RTCSessionDescription(data.offer)
            );

            await flushCandidates();

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            if (!pc.localDescription) return;

            sendSignal({
              type: 'WEBRTC_ANSWER',
              sessionId,
              participantId,
              answer: pc.localDescription.toJSON(),
            });

            console.log('[WEBRTC] ANSWER SENT');
          } catch (error) {
            console.error('[WEBRTC] Offer handling failed:', error);
          }

          return;
        }

        if (data.type === 'WEBRTC_ANSWER' && data.answer) {
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription(data.answer)
            );

            await flushCandidates();

            console.log('[WEBRTC] ANSWER APPLIED');
          } catch (error) {
            console.error('[WEBRTC] Answer handling failed:', error);
          }

          return;
        }

        if (data.type === 'WEBRTC_ICE' && data.candidate) {
          try {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(data.candidate);
            } else {
              pendingCandidates.current.push(data.candidate);
            }
          } catch (error) {
            if (!ignoreOffer.current) {
              console.error('[WEBRTC] ICE handling failed:', error);
            }
          }

          return;
        }

        if (data.type === 'PEER_LEFT') {
          setRemoteStream(null);
          remoteStreamRef.current = null;
          pendingCandidates.current = [];
        }
      } catch (error) {
        console.error('[WEBRTC] Message handling failed:', error);
      }
    };

    ws.addEventListener('message', handleMessage);

    return () => {
      ws.removeEventListener('message', handleMessage);

      pendingCandidates.current = [];
      remoteStreamRef.current = null;
      setRemoteStream(null);

      try {
        pc.close();
      } catch {
        // Ignore cleanup errors.
      }

      if (peerConnection.current === pc) {
        peerConnection.current = null;
      }

      console.log('[WEBRTC] PeerConnection cleaned up');
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
  };
}