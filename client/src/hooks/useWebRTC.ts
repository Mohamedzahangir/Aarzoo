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

    const createPeerConnection = () => {
      if (pc) {
        pc.close();
      }
      
      const newPc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      localStream.getTracks().forEach(track => {
        newPc.addTrack(track, localStream);
      });

      newPc.ontrack = (event) => {
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
        // New peer joined, rebuild connection and create offer
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
        // Received offer, rebuild connection and create answer
        pc = createPeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
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
        }
      } else if (data.type === 'WEBRTC_ICE' && data.participantId !== participantId) {
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => console.error(e));
        }
      } else if (data.type === 'PEER_LEFT' && data.participantId !== participantId) {
        setRemoteStream(null);
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
