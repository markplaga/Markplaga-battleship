let effectsAudioContext;

function getEffectsAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  effectsAudioContext ||= new AudioContextClass();
  if (effectsAudioContext.state === "suspended") effectsAudioContext.resume().catch(() => {});
  return effectsAudioContext;
}

function playEffectTone(context, options) {
  const {
    start,
    duration,
    frequency,
    endFrequency = frequency,
    volume,
    type = "sine",
    attack = .008,
  } = options;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(1, frequency), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + attack);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + .04);
}

function playEffectNoise(context, options) {
  const {
    start,
    duration,
    volume,
    frequency,
    endFrequency = frequency,
    filterType = "lowpass",
    q = .8,
  } = options;
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    const envelope = Math.pow(1 - index / length, 2.4);
    channel[index] = (Math.random() * 2 - 1) * envelope;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = filterType;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(Math.max(20, frequency), start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + .008);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(start);
  source.stop(start + duration + .02);
}

sound = function playSoundEffect(type) {
  if (!state.sound) return;
  try {
    const context = getEffectsAudioContext();
    if (!context) return;
    const now = context.currentTime + .012;

    if (type === "miss") {
      playEffectNoise(context, {
        start: now,
        duration: .13,
        volume: .055,
        frequency: 900,
        endFrequency: 300,
        filterType: "bandpass",
        q: 2.4,
      });
      playEffectTone(context, {
        start: now,
        duration: .31,
        frequency: 480,
        endFrequency: 135,
        volume: .14,
      });
      playEffectTone(context, {
        start: now + .025,
        duration: .25,
        frequency: 185,
        endFrequency: 78,
        volume: .075,
      });
      return;
    }

    if (type === "hit" || type === "sunk") {
      const sunk = type === "sunk";
      playEffectNoise(context, {
        start: now,
        duration: sunk ? .72 : .5,
        volume: sunk ? .38 : .3,
        frequency: 1900,
        endFrequency: 135,
      });
      playEffectTone(context, {
        start: now,
        duration: sunk ? .82 : .62,
        frequency: sunk ? 118 : 102,
        endFrequency: sunk ? 27 : 34,
        volume: sunk ? .25 : .2,
        type: "sawtooth",
      });
      playEffectTone(context, {
        start: now + .015,
        duration: sunk ? .96 : .74,
        frequency: 58,
        endFrequency: 24,
        volume: sunk ? .22 : .17,
      });
      if (sunk) {
        playEffectNoise(context, {
          start: now + .12,
          duration: .44,
          volume: .18,
          frequency: 540,
          endFrequency: 175,
          filterType: "bandpass",
          q: 1.2,
        });
      }
      return;
    }

    if (type === "victory") {
      const start = now + .24;
      const fanfare = [
        { at: 0, duration: .18, notes: [196, 293.66, 392] },
        { at: .23, duration: .2, notes: [261.63, 329.63, 392] },
        { at: .49, duration: .76, notes: [392, 523.25, 659.25] },
      ];
      for (const phrase of fanfare) {
        for (const note of phrase.notes) {
          playEffectTone(context, {
            start: start + phrase.at,
            duration: phrase.duration,
            frequency: note,
            endFrequency: note * .997,
            volume: .035,
            type: "sawtooth",
            attack: .014,
          });
          playEffectTone(context, {
            start: start + phrase.at,
            duration: phrase.duration,
            frequency: note,
            endFrequency: note,
            volume: .025,
            type: "triangle",
            attack: .012,
          });
        }
        playEffectTone(context, {
          start: start + phrase.at,
          duration: phrase.duration,
          frequency: phrase.notes[0] / 2,
          endFrequency: phrase.notes[0] / 2,
          volume: .065,
          type: "triangle",
          attack: .01,
        });
      }
      return;
    }

    if (type === "defeat") {
      playEffectTone(context, {
        start: now,
        duration: .85,
        frequency: 220,
        endFrequency: 72,
        volume: .11,
        type: "triangle",
      });
      playEffectTone(context, {
        start: now + .18,
        duration: .9,
        frequency: 132,
        endFrequency: 48,
        volume: .1,
        type: "sawtooth",
      });
      return;
    }

    const simpleEffects = {
      place: { frequency: 260, endFrequency: 190, duration: .09, volume: .055 },
      start: { frequency: 115, endFrequency: 165, duration: .34, volume: .08, type: "triangle" },
      error: { frequency: 150, endFrequency: 92, duration: .2, volume: .07, type: "square" },
    };
    const effect = simpleEffects[type] || { frequency: 220, endFrequency: 180, duration: .12, volume: .05 };
    playEffectTone(context, { start: now, ...effect });
  } catch {}
};

const originalSyncOnlineForSound = syncOnline;
syncOnline = function syncOnlineWithOutcomeSound(remote) {
  const previous = state.online.remote;
  originalSyncOnlineForSound(remote);
  const matchJustFinished = previous && previous.status !== "finished" && remote?.status === "finished";
  if (matchJustFinished) {
    const won = remote.winner === state.online.playerIndex;
    window.setTimeout(() => sound(won ? "victory" : "defeat"), 470);
  }
};
