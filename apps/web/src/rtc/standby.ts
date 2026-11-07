// Stand-in tracks used while the mic or camera is muted.
// They keep RTP flowing so a mute toggle never ends the sender or the peer connection.
// The singletons are never stopped: callers must not add them to a stream they later stop().

let blackVideo: MediaStreamTrack | null = null;
let blackTimer = 0;
let silentAudio: MediaStreamTrack | null = null;
let silentCtx: AudioContext | null = null;

/** Low-rate black frames. Safe to publish in place of the camera. */
export function blackVideoTrack(): MediaStreamTrack {
  if (blackVideo && blackVideo.readyState === 'live') return blackVideo;
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  const paint = () => {
    if (!ctx) return;
    ctx.fillStyle = '#16181d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  paint();
  // A fixed frame rate keeps the capture track producing frames even when the pixels do not change.
  const track = canvas.captureStream(5).getVideoTracks()[0];
  if (blackTimer) window.clearInterval(blackTimer);
  blackTimer = window.setInterval(paint, 200);
  track.contentHint = 'detail';
  track.addEventListener('ended', () => {
    if (blackVideo === track) blackVideo = null;
    if (blackTimer) window.clearInterval(blackTimer);
    blackTimer = 0;
  });
  blackVideo = track;
  return track;
}

/** A live, silent audio track. Safe to publish in place of the mic. */
export function silentAudioTrack(): MediaStreamTrack {
  if (silentAudio && silentAudio.readyState === 'live') return silentAudio;
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const osc = ctx.createOscillator();
  osc.frequency.value = 0;
  osc.connect(gain).connect(dest);
  osc.start();
  void ctx.resume().catch(() => undefined);
  const track = dest.stream.getAudioTracks()[0];
  track.addEventListener('ended', () => {
    if (silentAudio === track) silentAudio = null;
    if (silentCtx === ctx) {
      silentCtx = null;
      void ctx.close().catch(() => undefined);
    }
  });
  silentCtx = ctx;
  silentAudio = track;
  return track;
}
