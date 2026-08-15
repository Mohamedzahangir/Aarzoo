import { useState } from 'react';
import { Search, Play } from 'lucide-react';
import { musicProvider } from '../music/JioSaavnProvider';
import type { Song } from '../music/MusicProvider';

interface MusicPanelProps {
  ws: WebSocket | null;
  sessionId: string | undefined;
}

export function MusicPanel({ ws, sessionId }: MusicPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setSearching(true);
    const res = await musicProvider.search(query);
    setResults(res);
    setSearching(false);
  };

  const playSong = (song: Song) => {
    if (!ws || !sessionId) return;
    ws.send(JSON.stringify({
      type: 'MUSIC_TRACK_CHANGE',
      sessionId,
      song
    }));
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="p-4 border-b border-white/10">
        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs, artists..."
            className="glass-input w-full pl-10 pr-4 text-sm"
          />
          <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 transform -translate-y-1/2" />
        </form>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {searching ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : results.length > 0 ? (
          <div className="space-y-3">
            {results.map((song) => (
              <div key={song.id} className="flex items-center space-x-3 p-2 hover:bg-white/10 rounded-xl transition-colors group cursor-pointer" onClick={() => playSong(song)}>
                <img src={song.artwork} alt={song.title} className="w-12 h-12 rounded object-cover" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{song.title}</p>
                  <p className="text-gray-400 text-xs truncate">{song.artist}</p>
                </div>
                <button 
                  onClick={() => playSong(song)}
                  className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-primary transition-all"
                >
                  <Play className="w-4 h-4 text-white ml-0.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-center text-gray-500 py-10">
            <p className="text-sm">Search to listen together.</p>
          </div>
        )}
      </div>
    </div>
  );
}
