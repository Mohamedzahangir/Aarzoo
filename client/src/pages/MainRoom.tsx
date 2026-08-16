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
  const {
    sessionId,
  } = useParams<{
    sessionId: string;
  }>();

  const location =
    useLocation();

  const navigate =
    useNavigate();

  const displayName =
    location.state?.displayName ||
    'Guest';

  // ============================================================
  // STABLE PARTICIPANT ID
  // ============================================================

  const participantId =
    useRef(
      crypto.randomUUID()
    );

  // ============================================================
  // STATE
  // ============================================================

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

  // ============================================================
  // WEBRTC
  // ============================================================

  const {
    localStream,
    remoteStream,
    connectionState,
    iceConnectionState,
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
  // WEBSOCKET
  // ============================================================

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    console.log(
      '[ROOM] Creating WebSocket:',
      WS_URL
    );

    const websocket =
      new WebSocket(
        WS_URL
      );

    // ----------------------------------------------------------
    // MESSAGE HANDLER
    // ----------------------------------------------------------

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

          console.log(
            '[ROOM] SESSION PARTICIPANTS:',
            Object.keys(
              participants
            )
          );

          const peer =
            Object.values(
              participants
            ).find(
              (
                participant
              ) =>
                participant.participantId !==
                participantId.current
            );

          if (peer) {
            console.log(
              '[ROOM] PEER FOUND FROM SESSION_STATE:',
              peer.participantId
            );

            setPeerParticipantId(
              peer.participantId
            );
          } else {
            console.log(
              '[ROOM] No peer yet'
            );

            setPeerParticipantId(
              null
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
            '[ROOM] PEER_JOINED:',
            data.participantId
          );

          setPeerParticipantId(
            data.participantId
          );

          return;
        }

        // ======================================================
        // PEER LEFT
        // ======================================================

        if (
          data.type ===
          'PEER_LEFT' &&
          data.participantId
        ) {
          console.log(
            '[ROOM] PEER_LEFT:',
            data.participantId
          );

          setPeerParticipantId(
            (current) =>
              current ===
                data.participantId
                ? null
                : current
          );

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

          navigate('/');
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

    // ----------------------------------------------------------
    // OPEN
    // ----------------------------------------------------------

    websocket.onopen =
      () => {
        console.log(
          '[ROOM] WebSocket OPEN'
        );

        setConnected(true);

        const joinMessage = {
          type:
            'SESSION_JOIN',

          sessionId,

          participantId:
            participantId.current,

          displayName,
        };

        console.log(
          '[ROOM] Sending SESSION_JOIN:',
          joinMessage
        );

        websocket.send(
          JSON.stringify(
            joinMessage
          )
        );
      };

    // ----------------------------------------------------------
    // ERROR
    // ----------------------------------------------------------

    websocket.onerror =
      (error) => {
        console.error(
          '[ROOM] WebSocket ERROR:',
          error
        );
      };

    // ----------------------------------------------------------
    // CLOSE
    // ----------------------------------------------------------

    websocket.onclose =
      (event) => {
        console.log(
          '[ROOM] WebSocket CLOSED:',
          {
            code:
              event.code,
            reason:
              event.reason,
          }
        );

        setConnected(false);
        setPeerParticipantId(
          null
        );
      };

    // ----------------------------------------------------------
    // IMPORTANT
    //
    // Set WS immediately.
    //
    // The WebRTC hook's signaling listener will attach as soon
    // as this state is updated and will queue early OFFER/ICE
    // messages.
    // ----------------------------------------------------------

    setWs(websocket);

    // ----------------------------------------------------------
    // CLEANUP
    // ----------------------------------------------------------

    return () => {
      console.log(
        '[ROOM] Cleaning up WebSocket'
      );

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
      setPeerParticipantId(
        null
      );
      setConnected(false);
    };
  }, [
    sessionId,
    displayName,
    navigate,
  ]);

  // ============================================================
  // VIDEO STATUS
  // ============================================================

  let videoStatus =
    'Waiting for your person...';

  if (
    !peerParticipantId
  ) {
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
      'Video disconnected';
  } else {
    videoStatus =
      'Connecting video...';
  }

  // ============================================================
  // UI
  // ============================================================

  return (
    <div className="h-[100dvh] w-full flex flex-col md:flex-row overflow-hidden">

      {/* ======================================================
          LEFT: VIDEO
      ====================================================== */}

      <div className="flex-1 relative flex flex-col">

        {/* HEADER */}

        <div className="absolute top-0 left-0 right-0 p-6 z-20 flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent">

          <h1 className="text-xl font-serif font-bold tracking-widest text-white/90 drop-shadow-md">
            AARZOO
          </h1>

          <div className="flex items-center space-x-2 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-sm">

            <div
              className={`w-2 h-2 rounded-full ${connected
                  ? 'bg-green-500'
                  : 'bg-yellow-500 animate-pulse'
                }`}
            />

            <span className="text-sm text-gray-300 font-medium">
              {connected
                ? 'Connected'
                : 'Connecting...'}
            </span>

          </div>

        </div>

        {/* ====================================================
            REMOTE VIDEO
        ==================================================== */}

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
                    WebRTC:
                    {' '}
                    {connectionState}
                  </p>

                  <p>
                    ICE:
                    {' '}
                    {iceConnectionState}
                  </p>

                </div>
              )}

            </div>

          )}

        </div>

        {/* ====================================================
            LOCAL VIDEO
        ==================================================== */}

        <div className="absolute bottom-40 md:bottom-28 right-6 w-24 h-36 md:w-40 md:h-60 bg-gray-800 rounded-2xl overflow-hidden shadow-2xl border border-white/20 flex items-center justify-center z-20 transition-all hover:scale-105">

          {localStream &&
            cameraOn ? (

            <VideoPlayer
              stream={
                localStream
              }
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

        {/* MUSIC PLAYER */}

        <MusicPlayer
          ws={ws}
          sessionId={sessionId}
        />

        {/* ====================================================
            CONTROLS
        ==================================================== */}

        <div className="absolute bottom-0 left-0 right-0 p-6 flex justify-center items-center space-x-6 bg-gradient-to-t from-black/80 to-transparent z-20">

          {/* MIC */}

          <button
            onClick={() =>
              setMicOn(
                !micOn
              )
            }
            className={`p-4 rounded-full backdrop-blur-md transition-all ${micOn
                ? 'bg-white/10 hover:bg-white/20 text-white'
                : 'bg-red-500/90 hover:bg-red-500 text-white'
              }`}
          >

            {micOn ? (
              <Mic className="w-6 h-6" />
            ) : (
              <MicOff className="w-6 h-6" />
            )}

          </button>

          {/* CAMERA */}

          <button
            onClick={() =>
              setCameraOn(
                !cameraOn
              )
            }
            className={`p-4 rounded-full backdrop-blur-md transition-all ${cameraOn
                ? 'bg-white/10 hover:bg-white/20 text-white'
                : 'bg-red-500/90 hover:bg-red-500 text-white'
              }`}
          >

            {cameraOn ? (
              <Video className="w-6 h-6" />
            ) : (
              <VideoOff className="w-6 h-6" />
            )}

          </button>

          {/* LEAVE */}

          <button
            onClick={() =>
              navigate('/')
            }
            className="p-4 rounded-full bg-red-600 hover:bg-red-700 transition-all hover:scale-105 text-white"
            title="Leave Aarzoo"
          >

            <PhoneOff className="w-6 h-6" />

          </button>

        </div>

      </div>

      {/* ======================================================
          RIGHT PANEL
      ====================================================== */}

      <div className="w-full md:w-96 flex flex-col glass-panel h-[50dvh] md:h-[100dvh] border-0 md:border-l border-white/20 z-10">

        {/* TABS */}

        <div className="flex border-b border-white/10 p-2 shrink-0">

          {/* CHAT */}

          <button
            onClick={() =>
              setActiveTab(
                'chat'
              )
            }
            className={`flex-1 py-3 flex justify-center items-center space-x-2 rounded-lg transition-colors ${activeTab ===
                'chat'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/5'
              }`}
          >

            <MessageCircle className="w-4 h-4" />

            <span className="text-sm font-medium">
              Chat
            </span>

          </button>

          {/* MUSIC */}

          <button
            onClick={() =>
              setActiveTab(
                'music'
              )
            }
            className={`flex-1 py-3 flex justify-center items-center space-x-2 rounded-lg transition-colors ${activeTab ===
                'music'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/5'
              }`}
          >

            <Music className="w-4 h-4" />

            <span className="text-sm font-medium">
              Music
            </span>

          </button>

          {/* WATCH */}

          <button
            onClick={() =>
              setActiveTab(
                'watch'
              )
            }
            className={`flex-1 py-3 flex justify-center items-center space-x-2 rounded-lg transition-colors ${activeTab ===
                'watch'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/5'
              }`}
          >

            <Film className="w-4 h-4" />

            <span className="text-sm font-medium">
              Watch
            </span>

          </button>

        </div>

        {/* PANEL */}

        <div className="flex-1 overflow-hidden flex flex-col relative">

          {activeTab ===
            'chat' && (

              <ChatPanel
                ws={ws}
                sessionId={
                  sessionId
                }
                participantId={
                  participantId.current
                }
              />

            )}

          {activeTab ===
            'music' && (

              <MusicPanel
                ws={ws}
                sessionId={
                  sessionId
                }
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