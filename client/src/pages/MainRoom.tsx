import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  useParams,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MessageCircle,
  Music,
  Film,
  PhoneOff,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';

import { useWebRTC } from '../hooks/useWebRTC';

import { VideoPlayer } from '../components/VideoPlayer';
import { ChatPanel } from '../components/ChatPanel';
import { MusicPanel } from '../components/MusicPanel';
import { MusicPlayer } from '../components/MusicPlayer';

import { WS_URL } from '../config';

interface Participant {
  participantId: string;
  displayName?: string;
}

interface SessionState {
  sessionId?: string;
  participants?: Record<
    string,
    Participant
  >;
}

export default function MainRoom() {
  const { sessionId } =
    useParams<{
      sessionId: string;
    }>();

  const location =
    useLocation();

  const navigate =
    useNavigate();

  const displayName =
    location.state?.displayName ||
    'Guest';

  const participantId =
    useRef(
      crypto.randomUUID()
    );

  const leavingRef =
    useRef(false);

  const [
    connected,
    setConnected,
  ] = useState(false);

  const [
    peerParticipantId,
    setPeerParticipantId,
  ] = useState<string | null>(
    null
  );

  const [
    ws,
    setWs,
  ] = useState<WebSocket | null>(
    null
  );

  const [
    activeTab,
    setActiveTab,
  ] = useState<
    'chat' | 'music' | 'watch'
  >('chat');

  const [
    cameraOn,
    setCameraOn,
  ] = useState(true);

  const [
    micOn,
    setMicOn,
  ] = useState(true);

  const {
    localStream,
    remoteStream,
    connectionState,
    iceConnectionState,
    mediaState,
    mediaError,
    requestMedia,
  } = useWebRTC({
    ws,
    sessionId,
    participantId:
      participantId.current,
    peerParticipantId,
    cameraOn,
    micOn,
  });

  // ============================================================
  // GO HOME
  // ============================================================

  const goHome = () => {
    if (leavingRef.current) {
      return;
    }

    leavingRef.current = true;

    // Stop local media.
    if (localStream) {
      localStream
        .getTracks()
        .forEach((track) =>
          track.stop()
        );
    }

    navigate('/', {
      replace: true,
    });
  };

  // ============================================================
  // LEAVE SESSION
  // ============================================================

  const leaveSession = () => {
    if (leavingRef.current) {
      return;
    }

    leavingRef.current = true;

    console.log(
      '[ROOM] Leaving session'
    );

    if (
      ws &&
      ws.readyState ===
      WebSocket.OPEN
    ) {
      try {
        ws.send(
          JSON.stringify({
            type:
              'SESSION_LEAVE',

            sessionId,

            participantId:
              participantId.current,
          })
        );
      } catch (error) {
        console.error(
          '[ROOM] Failed to send SESSION_LEAVE:',
          error
        );
      }
    }

    if (localStream) {
      localStream
        .getTracks()
        .forEach((track) =>
          track.stop()
        );
    }

    navigate('/', {
      replace: true,
    });
  };

  // ============================================================
  // WEBSOCKET
  // ============================================================

  useEffect(() => {
    if (!sessionId) {
      navigate('/', {
        replace: true,
      });

      return;
    }

    const websocket =
      new WebSocket(
        WS_URL
      );

    const handleMessage = (
      event: MessageEvent
    ) => {
      try {
        const data =
          JSON.parse(
            event.data
          );

        console.log(
          '[ROOM] MESSAGE:',
          data.type
        );

        // ======================================================
        // SESSION STATE
        // ======================================================

        if (
          data.type ===
          'SESSION_STATE'
        ) {
          setConnected(true);

          const state =
            data.state as
            | SessionState
            | undefined;

          const participants =
            state?.participants ||
            {};

          const peer =
            Object.values(
              participants
            ).find(
              (participant) =>
                participant.participantId !==
                participantId.current
            );

          if (peer) {
            setPeerParticipantId(
              peer.participantId
            );
          }

          return;
        }

        // ======================================================
        // PEER JOINED
        // ======================================================

        if (
          data.type ===
          'PEER_JOINED' &&
          data.participantId &&
          data.participantId !==
          participantId.current
        ) {
          console.log(
            '[ROOM] Peer joined:',
            data.participantId
          );

          setPeerParticipantId(
            data.participantId
          );

          return;
        }

        // ======================================================
        // SESSION ENDED
        //
        // BOTH PEOPLE GO HOME.
        // ======================================================

        if (
          data.type ===
          'SESSION_ENDED'
        ) {
          console.log(
            '[ROOM] SESSION ENDED - returning home'
          );

          goHome();

          return;
        }

        // ======================================================
        // PEER LEFT
        //
        // ALSO RETURN HOME.
        // ======================================================

        if (
          data.type ===
          'PEER_LEFT'
        ) {
          console.log(
            '[ROOM] PEER LEFT - returning home'
          );

          goHome();

          return;
        }

        // ======================================================
        // ERROR
        // ======================================================

        if (
          data.type ===
          'ERROR'
        ) {
          console.error(
            '[ROOM] SERVER ERROR:',
            data.message
          );

          alert(
            data.message ||
            'Session error'
          );

          goHome();
        }
      } catch (error) {
        console.error(
          '[ROOM] Invalid WebSocket message:',
          error
        );
      }
    };

    websocket.addEventListener(
      'message',
      handleMessage
    );

    websocket.onopen =
      () => {
        console.log(
          '[ROOM] WebSocket OPEN'
        );

        const joinMessage = {
          type:
            'SESSION_JOIN',

          sessionId,

          participantId:
            participantId.current,

          displayName,
        };

        websocket.send(
          JSON.stringify(
            joinMessage
          )
        );
      };

    websocket.onerror =
      (error) => {
        console.error(
          '[ROOM] WebSocket ERROR:',
          error
        );
      };

    websocket.onclose =
      (event) => {
        console.log(
          '[ROOM] WebSocket CLOSED:',
          event.code
        );

        setConnected(false);

        /*
         * If we didn't intentionally leave, the session
         * disappeared unexpectedly.
         */
        if (
          !leavingRef.current
        ) {
          goHome();
        }
      };

    setWs(websocket);

    return () => {
      websocket.removeEventListener(
        'message',
        handleMessage
      );

      if (
        websocket.readyState ===
        WebSocket.OPEN ||
        websocket.readyState ===
        WebSocket.CONNECTING
      ) {
        websocket.close();
      }

      setWs(null);
    };
  }, [
    sessionId,
    displayName,
  ]);

  // ============================================================
  // VIDEO STATUS
  // ============================================================

  let videoStatus =
    'Waiting for your person...';

  if (!peerParticipantId) {
    videoStatus =
      'Waiting for your person...';
  } else if (
    connectionState ===
    'connected'
  ) {
    videoStatus =
      'Video connected';
  } else if (
    connectionState ===
    'failed'
  ) {
    videoStatus =
      'Video connection failed';
  } else if (
    connectionState ===
    'disconnected'
  ) {
    videoStatus =
      'Reconnecting...';
  } else {
    videoStatus =
      'Connecting video...';
  }

  // ============================================================
  // MEDIA PERMISSION
  // ============================================================

  const showMediaPermission =
    mediaState !== 'ready';

  // ============================================================
  // UI
  // ============================================================

  return (
    <div className="h-[100dvh] w-full flex flex-col md:flex-row overflow-hidden">

      {/* CAMERA + MICROPHONE PERMISSION */}

      {showMediaPermission && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-6">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.06] shadow-2xl p-8 text-center">

            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 border border-white/10">
              {mediaState === 'requesting' ? (
                <RefreshCw className="h-7 w-7 text-white animate-spin" />
              ) : (
                <ShieldCheck className="h-7 w-7 text-white" />
              )}
            </div>

            <h2 className="text-2xl font-serif font-semibold text-white">
              {mediaState === 'error'
                ? 'Camera & mic access needed'
                : 'Ready to connect?'}
            </h2>

            <p className="mt-3 text-sm leading-6 text-gray-400">
              {mediaState === 'error'
                ? mediaError ||
                'Please allow camera and microphone access to continue.'
                : 'Aarzoo needs access to your camera and microphone for the video call.'}
            </p>

            {mediaState === 'error' && (
              <div className="mt-4 rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-left text-xs text-gray-500">
                If you previously blocked access, open your browser's site permissions,
                allow Camera and Microphone, then try again.
              </div>
            )}

            <button
              type="button"
              disabled={mediaState === 'requesting'}
              onClick={() => {
                void requestMedia();
              }}
              className="mt-7 w-full rounded-2xl bg-white px-5 py-3.5 text-sm font-medium text-black transition hover:bg-gray-200 disabled:cursor-wait disabled:opacity-60"
            >
              {mediaState === 'requesting'
                ? 'Requesting access...'
                : mediaState === 'error'
                  ? 'Try Again'
                  : 'Allow Camera & Mic'}
            </button>

            <p className="mt-4 text-[11px] text-gray-600">
              Your browser will show its native permission prompt.
            </p>

          </div>
        </div>
      )}

      {/* VIDEO AREA */}

      <div className="flex-1 relative flex flex-col">

        {/* HEADER */}

        <div className="absolute top-0 left-0 right-0 p-6 z-20 flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent">

          <h1 className="text-xl font-serif font-bold tracking-widest text-white/90">
            AARZOO
          </h1>

          <div className="flex items-center space-x-2 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-sm">

            <div
              className={`w-2 h-2 rounded-full ${connected
                ? 'bg-green-500'
                : 'bg-yellow-500 animate-pulse'
                }`}
            />

            <span className="text-sm text-gray-300">
              {connected
                ? 'Connected'
                : 'Connecting...'}
            </span>

          </div>

        </div>

        {/* REMOTE VIDEO */}

        <div className="flex-1 w-full h-full relative flex items-center justify-center overflow-hidden">

          {remoteStream ? (

            <VideoPlayer
              stream={remoteStream}
              className="w-full h-full"
            />

          ) : (

            <div className="text-gray-500 flex flex-col items-center text-center">

              <VideoOff className="w-12 h-12 mb-4 opacity-30" />

              <p className="text-lg font-light text-gray-400">
                {videoStatus}
              </p>

              {peerParticipantId && (
                <div className="mt-3 text-xs text-gray-500 space-y-1">

                  <p>
                    WebRTC:{' '}
                    {connectionState}
                  </p>

                  <p>
                    ICE:{' '}
                    {iceConnectionState}
                  </p>

                </div>
              )}

            </div>

          )}

        </div>

        {/* LOCAL VIDEO */}

        <div className="absolute bottom-40 md:bottom-28 right-6 w-24 h-36 md:w-40 md:h-60 bg-gray-800 rounded-2xl overflow-hidden shadow-2xl border border-white/20 flex items-center justify-center z-20">

          {localStream &&
            cameraOn ? (

            <VideoPlayer
              stream={localStream}
              muted
              className="w-full h-full transform -scale-x-100"
            />

          ) : (

            <span className="text-gray-500 text-xs flex flex-col items-center">

              <VideoOff className="w-4 h-4 mb-1" />

              Camera Off

            </span>

          )}

        </div>

        <MusicPlayer
          ws={ws}
          sessionId={sessionId}
        />

        {/* CONTROLS */}

        <div className="absolute bottom-0 left-0 right-0 p-6 flex justify-center items-center space-x-6 bg-gradient-to-t from-black/80 to-transparent z-20">

          <button
            disabled={!localStream}
            onClick={() =>
              setMicOn(
                (value) =>
                  !value
              )
            }
            className={`p-4 rounded-full ${micOn
              ? 'bg-white/10 text-white'
              : 'bg-red-500 text-white'
              }`}
          >
            {micOn ? (
              <Mic className="w-6 h-6" />
            ) : (
              <MicOff className="w-6 h-6" />
            )}
          </button>

          <button
            disabled={!localStream}
            onClick={() =>
              setCameraOn(
                (value) =>
                  !value
              )
            }
            className={`p-4 rounded-full ${cameraOn
              ? 'bg-white/10 text-white'
              : 'bg-red-500 text-white'
              }`}
          >
            {cameraOn ? (
              <Video className="w-6 h-6" />
            ) : (
              <VideoOff className="w-6 h-6" />
            )}
          </button>

          <button
            onClick={
              leaveSession
            }
            className="p-4 rounded-full bg-red-600 hover:bg-red-700 text-white"
            title="Leave Aarzoo"
          >
            <PhoneOff className="w-6 h-6" />
          </button>

        </div>

      </div>

      {/* RIGHT PANEL */}

      <div className="w-full md:w-96 flex flex-col glass-panel h-[50dvh] md:h-[100dvh] border-0 md:border-l border-white/20 z-10">

        <div className="flex border-b border-white/10 p-2 shrink-0">

          <button
            onClick={() =>
              setActiveTab(
                'chat'
              )
            }
            className={`flex-1 py-3 flex justify-center items-center space-x-2 rounded-lg ${activeTab === 'chat'
              ? 'bg-white/10 text-white'
              : 'text-gray-400'
              }`}
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-sm">
              Chat
            </span>
          </button>

          <button
            onClick={() =>
              setActiveTab(
                'music'
              )
            }
            className={`flex-1 py-3 flex justify-center items-center space-x-2 rounded-lg ${activeTab === 'music'
              ? 'bg-white/10 text-white'
              : 'text-gray-400'
              }`}
          >
            <Music className="w-4 h-4" />
            <span className="text-sm">
              Music
            </span>
          </button>

          <button
            onClick={() =>
              setActiveTab(
                'watch'
              )
            }
            className={`flex-1 py-3 flex justify-center items-center space-x-2 rounded-lg ${activeTab === 'watch'
              ? 'bg-white/10 text-white'
              : 'text-gray-400'
              }`}
          >
            <Film className="w-4 h-4" />
            <span className="text-sm">
              Watch
            </span>
          </button>

        </div>

        <div className="flex-1 overflow-hidden flex flex-col relative">

          {activeTab ===
            'chat' && (
              <ChatPanel
                ws={ws}
                sessionId={sessionId}
                participantId={
                  participantId.current
                }
              />
            )}

          {activeTab ===
            'music' && (
              <MusicPanel
                ws={ws}
                sessionId={sessionId}
              />
            )}

          {activeTab ===
            'watch' && (
              <div className="h-full flex items-center justify-center text-center text-gray-500 p-8">
                <p className="text-sm">
                  Watch together
                  coming soon...
                </p>
              </div>
            )}

        </div>

      </div>

    </div>
  );
}