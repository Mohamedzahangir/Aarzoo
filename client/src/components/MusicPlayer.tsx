import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2 } from 'lucide-react';
import type { Song } from '../music/MusicProvider';

interface MusicPlayerProps {
  ws: WebSocket | null;
  sessionId: string | undefined;
}

export function MusicPlayer({ ws, sessionId }: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'MUSIC_TRACK_CHANGE':
          setCurrentSong(data.song);
          setIsPlaying(true);
          break;
        case 'MUSIC_PLAY':
          setIsPlaying(true);
          if (audioRef.current && Math.abs(audioRef.current.currentTime - data.position) > 2) {
             audioRef.current.currentTime = data.position;
          }
          break;
        case 'MUSIC_PAUSE':
          setIsPlaying(false);
          if (audioRef.current && data.position !== undefined) {
             audioRef.current.currentTime = data.position;
          }
          break;
        case 'MUSIC_SEEK':
          if (audioRef.current) {
            audioRef.current.currentTime = data.position;
          }
          break;
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);

  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(e => console.error('Audio play failed', e));
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying, currentSong]);

  const togglePlay = () => {
    if (!ws || !sessionId || !currentSong || !audioRef.current) return;
    
    const newIsPlaying = !isPlaying;
    setIsPlaying(newIsPlaying);
    
    ws.send(JSON.stringify({
      type: newIsPlaying ? 'MUSIC_PLAY' : 'MUSIC_PAUSE',
      sessionId,
      position: audioRef.current.currentTime
    }));
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setProgress(audioRef.current.currentTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
    setProgress(newTime);
    
    if (ws && sessionId) {
      ws.send(JSON.stringify({
        type: 'MUSIC_SEEK',
        sessionId,
        position: newTime
      }));
    }
  };

  if (!currentSong) return null;

  return (
    <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2 w-full max-w-md bg-surface/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl z-30 flex items-center space-x-4">
      <audio 
        ref={audioRef} 
        src={currentSong.streamUrl} 
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
      />
      
      <img src={currentSong.artwork} alt={currentSong.title} className="w-14 h-14 rounded-lg object-cover shadow-md" />
      
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium text-sm truncate">{currentSong.title}</p>
        <p className="text-gray-400 text-xs truncate">{currentSong.artist}</p>
        
        <div className="mt-2 flex items-center space-x-2">
          <span className="text-[10px] text-gray-500 w-8">{Math.floor(progress / 60)}:{(Math.floor(progress % 60)).toString().padStart(2, '0')}</span>
          <input 
            type="range" 
            min={0} 
            max={currentSong.duration || 100} 
            value={progress}
            onChange={handleSeek}
            className="flex-1 h-1 bg-white/10 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
          />
          <span className="text-[10px] text-gray-500 w-8">{Math.floor(currentSong.duration / 60)}:{(Math.floor(currentSong.duration % 60)).toString().padStart(2, '0')}</span>
        </div>
      </div>

      <button 
        onClick={togglePlay}
        className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform shrink-0"
      >
        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-1" />}
      </button>
    </div>
  );
}
