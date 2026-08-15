export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  duration: number; // in seconds
  streamUrl: string;
}

export interface MusicProvider {
  search(query: string): Promise<Song[]>;
  getSong(id: string): Promise<Song | null>;
}
