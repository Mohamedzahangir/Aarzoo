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
    if (!ws || !sessionId || !localStream) return;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.relay.metered.ca:80' },
        {
          urls: 'turn:global.relay.metered.ca:80',
          username: 'bccfab4c5208dda4f5970d61',
          credential: 'woyZUA3Cd0nbwoFt'
        },
        {
          urls: 'turn:global.relay.metered.ca:80?transport=tcp',
          username: 'bccfab4c5208dda4f5970d61',
          credential: 'woyZUA3Cd0nbwoFt'
        },
        {
          urls: 'turn:global.relay.metered.ca:443',
          username: 'bccfab4c5208dda4f5970d61',
          credential: 'woyZUA3Cd0nbwoFt'
        },
        {
          urls: 'turns:global.relay.metered.ca:443?transport=tcp',
          username: 'bccfab4c5208dda4f5970d61',
          credential: 'woyZUA3Cd0nbwoFt'
        }
      ]
    });
    peerConnection.current = pc;
    let pendingCandidates: RTCIceCandidateInit[] = [];

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
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        for (const candidate of pendingCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
        }
        pendingCandidates = [];
      } else if (data.type === 'WEBRTC_ICE' && data.participantId !== participantId) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.error);
        } else {
          pendingCandidates.push(data.candidate);
        }
      } else if (data.type === 'PEER_LEFT' && data.participantId !== participantId) {
        setRemoteStream(null);
        pendingCandidates = [];
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
