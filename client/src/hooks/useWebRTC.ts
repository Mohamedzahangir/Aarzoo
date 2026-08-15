import { useEffect, useRef, useState } from 'react';

interface WebRTCProps {
  ws: WebSocket | null;
  sessionId: string | undefined;
  participantId: string;
  cameraOn: boolean;
  micOn: boolean;
}

export function useWebRTC({ ws, sessionId, participantId, cameraOn, micOn }: WebRTCProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    async function setupLocalStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
      } catch (err) {
        console.error('Failed to get local media', err);
      }
    }
    setupLocalStream();

    return () => {
      localStream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  useEffect(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => track.enabled = cameraOn);
      localStream.getAudioTracks().forEach(track => track.enabled = micOn);
    }
  }, [localStream, cameraOn, micOn]);

  useEffect(() => {
    if (!ws || !sessionId || !localStream) return;

    let pc: RTCPeerConnection | null = null;
    let pendingCandidates: RTCIceCandidateInit[] = [];

    const createPeerConnection = () => {
      if (pc) {
        pc.close();
      }
      // DO NOT clear pendingCandidates here, as early candidates for the new offer might be queued.
      
      const newPc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ]
      });
      
      localStream.getTracks().forEach(track => {
        newPc.addTrack(track, localStream);
      });

      newPc.ontrack = (event) => {
        console.log('Received remote track', event.streams[0]);
        setRemoteStream(event.streams[0]);
      };

      newPc.onicecandidate = (event) => {
        if (event.candidate) {
          ws.send(JSON.stringify({
            type: 'WEBRTC_ICE',
            sessionId,
            participantId,
            candidate: event.candidate
          }));
        }
      };

      peerConnection.current = newPc;
      return newPc;
    };

    // Initialize connection ready for offers
    pc = createPeerConnection();

    const handleMessage = async (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'PEER_JOINED' && data.participantId !== participantId) {
        // New peer joined, clear stale candidates, rebuild connection and create offer
        pendingCandidates = [];
        pc = createPeerConnection();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({
          type: 'WEBRTC_OFFER',
          sessionId,
          participantId,
          offer
        }));
      } else if (data.type === 'WEBRTC_OFFER' && data.participantId !== participantId) {
        // Received offer, rebuild connection (keep early candidates!) and create answer
        pc = createPeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        // Process any queued candidates that arrived before the offer
        for (const candidate of pendingCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
        }
        pendingCandidates = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({
          type: 'WEBRTC_ANSWER',
          sessionId,
          participantId,
          answer
        }));
      } else if (data.type === 'WEBRTC_ANSWER' && data.participantId !== participantId) {
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          // Process any queued candidates that arrived before the answer
          for (const candidate of pendingCandidates) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
          }
          pendingCandidates = [];
        }
      } else if (data.type === 'WEBRTC_ICE' && data.participantId !== participantId) {
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => console.error(e));
        } else {
          // Remote description not set yet, queue the candidate
          pendingCandidates.push(data.candidate);
        }
      } else if (data.type === 'PEER_LEFT' && data.participantId !== participantId) {
        setRemoteStream(null);
        pendingCandidates = [];
        if (pc) {
          pc.close();
          pc = null;
          peerConnection.current = null;
        }
      }
    };

    ws.addEventListener('message', handleMessage);

    return () => {
      ws.removeEventListener('message', handleMessage);
      if (pc) {
        pc.close();
      }
    };
  }, [ws, sessionId, participantId, localStream]);

  return { localStream, remoteStream };
}
