import { UserFacingError } from '$lib/server/errors';

type NeteaseApi = {
  playlist_detail: (params: { id: string }) => Promise<NeteasePlaylistResponse>;
  song_detail: (params: { ids: string }) => Promise<NeteaseSongResponse>;
};

type NeteaseArtist = {
  name?: unknown;
};

type NeteaseTrack = {
  name?: unknown;
  ar?: NeteaseArtist[];
  artists?: NeteaseArtist[];
};

type NeteasePlaylistResponse = {
  body?: {
    code?: number;
    playlist?: {
      trackIds?: NeteaseTrackId[];
    };
  };
};

type NeteaseSongResponse = {
  body?: {
    code?: number;
    songs?: NeteaseTrack[];
  };
};

export type NeteasePlaylistSong = {
  title: string;
  artist: string;
};

type NeteaseTrackId = {
  id?: unknown;
};

const songDetailBatchSize = 1000;

const getNeteaseApi = async () =>
  ((await import('@neteasecloudmusicapienhanced/api')) as { default: NeteaseApi }).default;

const extractNeteaseId = (value: string, pathName: string, errorMessage: string) => {
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  const idFromQuery = trimmed.match(/[?&]id=(\d+)/)?.[1];

  if (idFromQuery) {
    return idFromQuery;
  }

  const idFromPath = trimmed.match(new RegExp(`${pathName}/(\\d+)`))?.[1];

  if (idFromPath) {
    return idFromPath;
  }

  throw new UserFacingError(errorMessage);
};

const extractPlaylistId = (value: string) =>
  extractNeteaseId(value, 'playlist', '请填写有效的网易云公开歌单链接或 ID。');

const extractSongId = (value: string) => extractNeteaseId(value, 'song', '请填写有效的网易云单曲链接或 ID。');

const getArtistName = (artist: NeteaseArtist) => (typeof artist.name === 'string' ? artist.name.trim() : '');

const getTrackId = (trackId: NeteaseTrackId) =>
  typeof trackId.id === 'number' || typeof trackId.id === 'string' ? String(trackId.id) : '';

const mapTrack = (track: NeteaseTrack): NeteasePlaylistSong | null => {
  const title = typeof track.name === 'string' ? track.name.trim() : '';
  const artists = (track.ar ?? track.artists ?? []).map(getArtistName).filter(Boolean);

  if (!title || artists.length === 0) {
    return null;
  }

  return {
    title,
    artist: artists.join(' / ')
  };
};

export const fetchNeteasePlaylistSongs = async (playlistInput: string, maxSongs: number) => {
  const playlistId = extractPlaylistId(playlistInput);
  const api = await getNeteaseApi();
  const response = await api.playlist_detail({ id: playlistId });
  const trackIds = response.body?.playlist?.trackIds;

  if (response.body?.code !== 200 || !Array.isArray(trackIds)) {
    throw new UserFacingError('读取网易云公开歌单失败。');
  }

  if (trackIds.length > maxSongs) {
    throw new UserFacingError(`单次最多导入 ${maxSongs} 首歌曲。`);
  }

  const ids = trackIds.map(getTrackId).filter(Boolean);
  const tracks: NeteaseTrack[] = [];

  for (let index = 0; index < ids.length; index += songDetailBatchSize) {
    const detail = await api.song_detail({ ids: ids.slice(index, index + songDetailBatchSize).join(',') });
    const detailTracks = detail.body?.songs;

    if (detail.body?.code !== 200 || !Array.isArray(detailTracks)) {
      throw new UserFacingError('读取网易云公开歌单失败。');
    }

    tracks.push(...detailTracks);
  }

  const songs = tracks.map(mapTrack).filter((song): song is NeteasePlaylistSong => song !== null);

  if (songs.length === 0) {
    throw new UserFacingError('这个歌单没有可导入的歌曲。');
  }

  return songs;
};

export const fetchNeteaseSong = async (songInput: string) => {
  const songId = extractSongId(songInput);
  const api = await getNeteaseApi();
  const response = await api.song_detail({ ids: songId });
  const track = response.body?.songs?.[0];

  if (response.body?.code !== 200 || !track) {
    throw new UserFacingError('读取网易云单曲失败。');
  }

  const song = mapTrack(track);

  if (!song) {
    throw new UserFacingError('读取网易云单曲失败。');
  }

  return song;
};
