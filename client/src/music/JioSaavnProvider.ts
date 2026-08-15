import type { MusicProvider, Song } from './MusicProvider';

const API_BASE = 'https://saavn-api.vercel.app';

export class JioSaavnProvider implements MusicProvider {
  
  async search(query: string): Promise<Song[]> {
    try {
      const res = await fetch(`${API_BASE}/search/songs?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      
      if (Array.isArray(data)) {
        return data.map(this.mapSong);
      }
      return [];
    } catch (e) {
      console.error('Music search failed', e);
      return [];
    }
  }

  async getSong(id: string): Promise<Song | null> {
    // This API does not have a /songs/:id endpoint directly that matches this format easily, 
    // but the ID can usually be searched. For our usecase, we don't strictly need getSong yet
    // since we pass the whole Song object over WebSocket.
    return null;
  }

  private mapSong = (item: any): Song => {
    return {
      id: item.id,
      title: item.title || item.name,
      artist: item.artists || item.subtitle || 'Unknown Artist',
      album: item.album || '',
      artwork: item.image || '',
      duration: parseInt(item.duration || '0', 10),
      streamUrl: item.url || ''
    };
  }
}

export const musicProvider = new JioSaavnProvider();
