import type { MusicProvider, Song } from './MusicProvider';

const API_BASE = 'https://saavn-api.vercel.app';

export class JioSaavnProvider implements MusicProvider {

  async search(query: string): Promise<Song[]> {
    const searchQuery = query.trim();

    if (!searchQuery) {
      return [];
    }

    try {
      const url = `${API_BASE}/search/${encodeURIComponent(searchQuery)}`;

      console.log('[MUSIC] Searching:', url);

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Music API request failed: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      console.log('[MUSIC] API response:', data);

      if (!Array.isArray(data)) {
        console.error('[MUSIC] Unexpected API response:', data);
        return [];
      }

      const songs: Song[] = data
        .map((item: any): Song | null => {
          if (!item || !item.id) {
            return null;
          }

          return {
            id: String(item.id),

            title: String(
              item.title ||
              item.name ||
              'Unknown Song'
            ),

            artist: String(
              item.artists ||
              item.subtitle ||
              'Unknown Artist'
            ),

            album: String(
              item.album ||
              ''
            ),

            artwork: String(
              item.image ||
              ''
            ),

            duration: Number(
              item.duration || 0
            ),

            streamUrl: String(
              item.url ||
              ''
            )
          };
        })
        .filter(
          (song): song is Song =>
            song !== null && song.streamUrl.length > 0
        );

      console.log('[MUSIC] Songs found:', songs);

      return songs;

    } catch (error) {
      console.error('[MUSIC] Search failed:', error);

      return [];
    }
  }

  async getSong(id: string): Promise<Song | null> {
    // We already receive the complete Song object from search().
    // No additional request is required for the current Aarzoo music flow.
    return null;
  }
}

export const musicProvider = new JioSaavnProvider();