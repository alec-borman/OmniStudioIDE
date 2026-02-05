import { CompiledScore, NoteEvent, StaffStyle } from '../types';
import { TICKS_PER_QUARTER } from '../constants';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private isPlaying = false;
  private timerID: number | null = null;
  private currentTick = 0;
  private startTime = 0;
  private score: CompiledScore | null = null;
  private lookahead = 0.1; 
  private scheduleAheadTime = 0.1;
  private nextNoteIndex = 0;

  public onTick: (tick: number) => void = () => {};
  public onStop: () => void = () => {};

  constructor() {}

  private initContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public loadScore(score: CompiledScore) {
    this.score = score;
    this.reset();
  }

  public play() {
    this.initContext();
    if (!this.score || !this.ctx) return;
    
    if (this.isPlaying) return;
    
    this.isPlaying = true;
    this.nextNoteIndex = 0;
    
    // Resume tick
    for(let i=0; i<this.score.timeline.length; i++) {
        if (this.score.timeline[i].tickStart >= this.currentTick) {
            this.nextNoteIndex = i;
            break;
        }
    }

    this.startTime = this.ctx.currentTime;
    this.scheduler();
  }

  public pause() {
    this.isPlaying = false;
    if (this.timerID !== null) window.clearTimeout(this.timerID);
  }

  public stop() {
    this.pause();
    this.currentTick = 0;
    this.onTick(0);
    this.onStop();
  }

  private reset() {
    this.currentTick = 0;
    this.nextNoteIndex = 0;
  }

  private scheduler() {
    if (!this.isPlaying || !this.ctx || !this.score) return;

    const secondsPerTick = 60 / (this.score.meta.tempo * TICKS_PER_QUARTER);
    
    while (
        this.nextNoteIndex < this.score.timeline.length &&
        this.score.timeline[this.nextNoteIndex].tickStart * secondsPerTick < this.ctx.currentTime - this.startTime + this.scheduleAheadTime
    ) {
        this.scheduleNote(this.score.timeline[this.nextNoteIndex]);
        this.nextNoteIndex++;
    }

    const estimatedTick = (this.ctx.currentTime - this.startTime) / secondsPerTick;
    this.currentTick = estimatedTick;
    this.onTick(this.currentTick);

    if (this.currentTick > this.score.durationTicks + TICKS_PER_QUARTER) {
        this.stop();
        return;
    }

    this.timerID = window.setTimeout(() => this.scheduler(), this.lookahead * 1000);
  }

  private scheduleNote(event: NoteEvent) {
    if (!this.ctx || event.type === 'rest') return;

    const secondsPerTick = 60 / (this.score!.meta.tempo * TICKS_PER_QUARTER);
    const playTime = this.startTime + (event.tickStart * secondsPerTick);
    let durationSec = (event.tickEnd - event.tickStart) * secondsPerTick;

    const inst = this.score!.instruments.find(i => i.id === event.instrumentId);
    if (!inst) return;

    // Apply modifiers from Attributes
    let vel = event.velocity;
    const mods = event.modifiers.map(m => m.name);
    
    if (mods.includes('ghost')) vel *= 0.4;
    if (mods.includes('acc')) vel *= 1.3;
    if (mods.includes('stacc')) durationSec *= 0.5;
    if (mods.includes('ten')) durationSec *= 1.0; 
    if (mods.includes('fermata')) durationSec *= 2.0;

    // Dynamics
    if (mods.includes('pp')) vel = 0.3;
    else if (mods.includes('p')) vel = 0.4;
    else if (mods.includes('mp')) vel = 0.5;
    else if (mods.includes('mf')) vel = 0.7;
    else if (mods.includes('f')) vel = 0.85;
    else if (mods.includes('ff')) vel = 1.0;

    // Manual Vol
    const volAttr = event.modifiers.find(m => m.name === 'vol');
    if (volAttr && volAttr.args[0]) {
        vel = Number(volAttr.args[0]) / 127; 
    }

    event.pitches.forEach(pitch => {
        if (pitch.startsWith('midi:')) {
            const midi = parseInt(pitch.split(':')[1], 10);
            
            if (inst.style === StaffStyle.GRID) {
                this.playDrum(midi, playTime, vel);
            } else {
                if (inst.id.includes('bass')) {
                   this.playString(midi, playTime, durationSec, vel, 'triangle');
                } else if (inst.id.includes('pno')) {
                   this.playGeneric(midi, playTime, durationSec, vel);
                } else {
                   this.playString(midi, playTime, durationSec, vel, 'sawtooth');
                }
            }
        }
    });
  }

  private mtof(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  private playString(midi: number, time: number, duration: number, vel: number, type: OscillatorType) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.value = this.mtof(midi);

    filter.type = 'lowpass';
    filter.frequency.value = 800 + (vel * 3000);
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vel * 0.4, time + 0.05); 
    gain.gain.setTargetAtTime(0, time + duration - 0.05, 0.1);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(time);
    osc.stop(time + duration + 0.2);
  }

  private playGeneric(midi: number, time: number, duration: number, vel: number) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.value = this.mtof(midi);
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vel * 0.5, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, time + duration + 0.2);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start(time);
    osc.stop(time + duration + 0.5);
  }

  private playDrum(midi: number, time: number, vel: number) {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      // Basic Drum Synthesis
      if (midi < 40) { // Kick
          osc.frequency.setValueAtTime(150, time);
          osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
          gain.gain.setValueAtTime(vel, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
      } else { // Snare/Hat
          osc.type = 'square';
          osc.frequency.setValueAtTime(100 + Math.random()*100, time);
          gain.gain.setValueAtTime(vel * 0.5, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
      }

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + 0.5);
  }
}
