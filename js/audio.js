export const AudioEngine = (() => {
  let context;

  async function prepare() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    try {
      context ||= new AudioContext();
      if (context.state === "suspended") await context.resume();
      return context.state === "running" ? context : null;
    } catch {
      return null;
    }
  }

  async function play(start, end = start, gain = 0.075, type = "sine") {
    const audio = await prepare();
    if (!audio) return;
    try {
      const now = audio.currentTime;
      const tone = audio.createOscillator();
      const envelope = audio.createGain();
      tone.type = type;
      tone.frequency.setValueAtTime(start, now);
      if (end !== start) tone.frequency.exponentialRampToValueAtTime(end, now + 0.12);
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(gain, now + 0.018);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
      tone.connect(envelope);
      envelope.connect(audio.destination);
      tone.onended = () => {
        tone.disconnect();
        envelope.disconnect();
      };
      tone.start(now);
      tone.stop(now + 0.15);
    } catch {
      // Animation and haptics still respond when audio is unavailable.
    }
  }

  return {
    prepare,
    chime: () => play(523.25),
    bonk: () => play(118, 53, 0.13, "triangle"),
    pop: () => play(345, 740, 0.1),
    waterDrop: () => play(660, 355, 0.065),
  };
})();
