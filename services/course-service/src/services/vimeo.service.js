/**
 * Build playback payload for the Vimeo player.
 * When VIMEO_ACCESS_TOKEN is set, a future version can call Vimeo API for signed playback.
 */
function getPlaybackPayload(videoIdRaw, _userId) {
  const videoId = String(videoIdRaw || '').trim();
  if (!videoId) {
    return { videoId: null, embedUrl: null, provider: 'vimeo' };
  }
  const token = process.env.VIMEO_ACCESS_TOKEN || '';
  return {
    videoId,
    embedUrl: `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`,
    provider: 'vimeo',
    signedPlaybackAvailable: Boolean(token),
  };
}

module.exports = { getPlaybackPayload };
