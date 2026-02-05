export interface OmniMeta {
  title: string;
  composer: string;
  tempo: number;
  timeSignature: [number, number];
  key: string;
  style: string;
  pickup?: number;
}

export enum StaffStyle {
  STANDARD = 'standard',
  TAB = 'tab',
  GRID = 'grid',
}

export type DrumMapValue = number | [number, number]; // [Position, Midi]

export interface Attribute {
    name: string;
    args: (string | number)[];
}

export interface InstrumentDef {
  id: string;
  label: string;
  group?: string;
  style: StaffStyle;
  clef?: string;
  transpose?: number;
  tuning?: string[];
  map?: Record<string, DrumMapValue>; 
  patch?: string;
  vol?: number;
  pan?: number;
}

export interface NoteEvent {
  type: 'note' | 'rest' | 'chord';
  pitches: string[];     // "midi:60" or "tab:0-6"
  duration: number;      // In QUARTER NOTES (floating point for logic)
  tickStart: number;     // Absolute ticks
  tickEnd: number;       // Absolute ticks
  velocity: number;
  instrumentId: string;
  voiceId: string;       // 'v1', 'v2', etc.
  modifiers: Attribute[];
}

export interface CompiledScore {
  meta: OmniMeta;
  instruments: InstrumentDef[];
  timeline: NoteEvent[];
  durationTicks: number;
}

export interface VoiceCursor {
  octave: number;
  duration: number; // in logical quarters (e.g. 1.0 = quarter, 0.5 = eighth)
  tick: number;     // absolute tick position in measure logic
}

export interface MacroDef {
  params: string[];
  body: string;
}
