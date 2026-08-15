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
  const [iceServers, setIceServers] = useState<RTCIceServer[] | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    async function fetchIceServers() {
      try {
        const response = await fetch("https://zahangir.metered.live/api/v1/turn/credentials?apiKey=3608497fdac665c4c32ce1ce0c3147ebd7cf");
        const servers = await response.json();
        setIceServers(servers);
      } catch (err) {
        console.error("Failed to fetch TURN servers, falling back to STUN", err);
        setIceServers([{ urls: 'stun:stun.l.google.com:19302' }]);
      }
    }
    fetchIceServers();
  }, []);

  useEffect(() => {
    async function setupLocalStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user'
          }, 
          audio: true 
        });
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
    if (!ws || !sessionId || !localStream || !iceServers) return;

    const pc = new RTCPeerConnection({
      iceServers: iceServers
    });
    peerConnection.current = pc;

    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    pc.ontrack = (event) => {
      console.log('Received remote track', event);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      } else {
        const stream = new MediaStream([event.track]);
        setRemoteStream(stream);
      }
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
        const offer = await pc.createOffer({ iceRestart: true });
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
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.error);
        }
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
