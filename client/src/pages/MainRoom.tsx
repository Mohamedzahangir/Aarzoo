import { useEffect, useState, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, MessageCircle, Music, Film, PhoneOff } from 'lucide-react';
import { useWebRTC } from '../hooks/useWebRTC';
import { VideoPlayer } from '../components/VideoPlayer';
import { ChatPanel } from '../components/ChatPanel';
import { MusicPanel } from '../components/MusicPanel';
import { MusicPlayer } from '../components/MusicPlayer';

export default function MainRoom() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const displayName = location.state?.displayName || 'Guest';

  const [connected, setConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'music' | 'watch'>('chat');
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [ws, setWs] = useState<WebSocket | null>(null);
  
  const participantId = useRef(Math.random().toString(36).substring(7));

  const { localStream, remoteStream } = useWebRTC({ 
    ws, 
    sessionId, 
    participantId: participantId.current, 
    cameraOn, 
    micOn 
  });

  useEffect(() => {
    const websocket = new WebSocket('ws://localhost:3001');
    
    websocket.onopen = () => {
      websocket.send(JSON.stringify({
        type: 'SESSION_JOIN',
        sessionId,
        participantId: participantId.current,
        displayName
      }));
    };

    websocket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'SESSION_STATE') {
        setConnected(true);
      } else if (data.type === 'ERROR') {
        alert(data.message);
        navigate('/');
      }
    });

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, [sessionId, displayName, navigate]);

  return (
    <div className="min-h-screen bg-black flex flex-col md:flex-row overflow-hidden">
      {/* LEFT: Video Area */}
      <div className="flex-1 relative flex flex-col bg-gray-900 border-r border-white/10">
        
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 p-6 z-20 flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent">
          <h1 className="text-xl font-bold tracking-widest text-white/90 drop-shadow-md">AARZOO</h1>
          <div className="flex items-center space-x-2 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-sm">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
            <span className="text-sm text-gray-300 font-medium">
              {connected ? 'Connected' : 'Connecting...'}
            </span>
          </div>
        </div>

        {/* Remote Video */}
        <div className="flex-1 w-full h-full bg-surface relative flex items-center justify-center overflow-hidden">
          {remoteStream ? (
            <VideoPlayer stream={remoteStream} className="w-full h-full" />
          ) : (
            <div className="text-gray-500 flex flex-col items-center">
              <VideoOff className="w-12 h-12 mb-4 opacity-30" />
              <p className="text-lg font-light text-gray-400">Waiting for your person...</p>
            </div>
          )}
        </div>

        {/* Local Video (Floating) */}
        <div className="absolute bottom-40 md:bottom-28 right-6 w-24 h-36 md:w-40 md:h-60 bg-gray-800 rounded-2xl overflow-hidden shadow-2xl border border-white/20 flex items-center justify-center z-20 transition-all hover:scale-105">
          {localStream && cameraOn ? (
            <VideoPlayer stream={localStream} muted={true} className="w-full h-full transform -scale-x-100" />
          ) : (
             <span className="text-gray-500 text-xs flex flex-col items-center">
               <VideoOff className="w-4 h-4 mb-1" />
               Camera Off
             </span>
          )}
        </div>

        {/* Floating Music Player */}
        <MusicPlayer ws={ws} sessionId={sessionId} />

        {/* Bottom Controls */}
        <div className="absolute bottom-0 left-0 right-0 p-6 flex justify-center items-center space-x-6 bg-gradient-to-t from-black/80 to-transparent z-20">
          <button 
            onClick={() => setMicOn(!micOn)}
            className={`p-4 rounded-full backdrop-blur-md transition-all ${micOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/90 hover:bg-red-500 text-white'}`}
          >
            {micOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </button>
          
          <button 
            onClick={() => setCameraOn(!cameraOn)}
            className={`p-4 rounded-full backdrop-blur-md transition-all ${cameraOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/90 hover:bg-red-500 text-white'}`}
          >
            {cameraOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          </button>

          <button 
            onClick={() => navigate('/')}
            className="p-4 rounded-full bg-red-600 hover:bg-red-700 transition-all hover:scale-105 text-white"
            title="Leave Aarzoo"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* RIGHT: Interaction Panel */}
      <div className="w-full md:w-96 flex flex-col bg-surface border-l border-white/5 h-[50vh] md:h-screen">
        {/* Tabs */}
        <div className="flex border-b border-white/10 p-2 shrink-0">
          <button 
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-3 flex justify-center items-center space-x-2 rounded-lg transition-colors ${activeTab === 'chat' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-400 hover:bg-white/5'}`}
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-sm font-medium">Chat</span>
          </button>
          <button 
            onClick={() => setActiveTab('music')}
            className={`flex-1 py-3 flex justify-center items-center space-x-2 rounded-lg transition-colors ${activeTab === 'music' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-400 hover:bg-white/5'}`}
          >
            <Music className="w-4 h-4" />
            <span className="text-sm font-medium">Music</span>
          </button>
          <button 
            onClick={() => setActiveTab('watch')}
            className={`flex-1 py-3 flex justify-center items-center space-x-2 rounded-lg transition-colors ${activeTab === 'watch' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-400 hover:bg-white/5'}`}
          >
            <Film className="w-4 h-4" />
            <span className="text-sm font-medium">Watch</span>
          </button>
        </div>

        {/* Panel Content */}
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {activeTab === 'chat' && (
            <ChatPanel ws={ws} sessionId={sessionId} participantId={participantId.current} />
          )}
          {activeTab === 'music' && (
            <MusicPanel ws={ws} sessionId={sessionId} />
          )}
          {activeTab === 'watch' && (
             <div className="h-full flex items-center justify-center text-center text-gray-500 p-8">
               <p className="text-sm">Watch together coming soon...</p>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
