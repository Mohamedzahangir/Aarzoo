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

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnection.current = pc;

    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.send(JSON.stringify({
          type: 'WEBRTC_ICE',
          sessionId,
          participantId,
          candidate: event.candidate
        }));
      }
    };

    const handleMessage = async (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.type === 'PEER_JOINED' && data.participantId !== participantId) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({
          type: 'WEBRTC_OFFER',
          sessionId,
          participantId,
          offer
        }));
      } else if (data.type === 'WEBRTC_OFFER' && data.participantId !== participantId) {
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
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } else if (data.type === 'WEBRTC_ICE' && data.participantId !== participantId) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else if (data.type === 'PEER_LEFT' && data.participantId !== participantId) {
        setRemoteStream(null);
      }
    };

    ws.addEventListener('message', handleMessage);

    return () => {
      ws.removeEventListener('message', handleMessage);
      pc.close();
    };
  }, [ws, sessionId, participantId, localStream]);

  return { localStream, remoteStream };
}
