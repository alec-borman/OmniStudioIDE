import { CompiledScore, InstrumentDef, MacroDef, NoteEvent, StaffStyle, VoiceCursor, Attribute, TimeSignatureEvent } from '../types';
import { GM_DRUM_MAP, GUITAR_STD_TUNING, TICKS_PER_QUARTER } from '../constants';

/**
 * OmniParser V2 / Tenuto 2.0
 * Implements the OmniScore & Tenuto Specifications
 */

// Fix: Added '/' to identifier regex to support '6/8' as a single token
const REGEX_TOKEN = /([{}|,\[\]=()])|("[^"]*")|(\$[a-zA-Z_][a-zA-Z0-9_]*)|([a-zA-Z0-9_.\-+#:/]+)/g;
const REGEX_PITCH = /^([a-g])(qs|qf|tqs|tqf|x|bb|b|#|n)*(-?\d+)?$/i;

export class OmniParser {
  private source: string;
  private tokens: string[] = [];
  private tokenIndex = 0;
  
  private score: CompiledScore;
  
  // State Tracking
  private macros: Record<string, MacroDef> = {};
  private currentGroup: string | undefined;
  
  // Measure & Time Signature Tracking (Tenuto 2.0)
  private currentNum = 4;
  private currentDen = 4;
  private lastParsedMeasureIndex = 0;
  
  // Sticky State (Instrument -> Voice -> Cursor)
  private globalCursors: Record<string, Record<string, VoiceCursor>> = {};

  constructor(code: string) {
    this.source = code;
    this.score = {
      meta: {
        title: "Untitled",
        composer: "Unknown",
        tempo: 120,
        timeSignature: [4, 4],
        key: "C",
        style: "standard"
      },
      instruments: [],
      timeline: [],
      durationTicks: 0,
      timeSignatures: [],
      measureStartTicks: { 1: 0 }
    };
  }

  public parse(): CompiledScore {
    // 1. Pre-process (Comments)
    const cleanCode = this.source.replace(/%%.*$/gm, '');
    
    // 2. Tokenize
    this.tokens = cleanCode.match(REGEX_TOKEN) || [];
    this.tokenIndex = 0;

    // 3. Root Block (omniscore or tenuto)
    const rootToken = this.peek().toLowerCase();
    if (rootToken === 'omniscore' || rootToken === 'tenuto') {
      this.consume();
      if (this.match('{')) {
        this.parseBody();
        this.match('}'); 
      }
    } else {
      // Lenient Mode: Implicit root
      this.parseBody();
    }

    // 4. Finalize
    this.score.timeline.sort((a, b) => a.tickStart - b.tickStart);
    if (this.score.timeline.length > 0) {
        const last = this.score.timeline[this.score.timeline.length - 1];
        this.score.durationTicks = last.tickEnd;
    }
    
    // Ensure initial time signature is recorded
    if (this.score.timeSignatures.length === 0) {
        this.score.timeSignatures.push({ 
            measureIndex: 1, 
            num: this.score.meta.timeSignature[0], 
            den: this.score.meta.timeSignature[1] 
        });
    }

    return this.score;
  }

  private parseBody() {
    while (this.tokenIndex < this.tokens.length && this.peek() !== '}') {
      const t = this.peek();
      
      if (t.toLowerCase() === 'meta') {
        this.parseMetaBlock(true); // Global meta
      } else if (t.toLowerCase() === 'macro') {
        this.parseMacroDef();
      } else if (t.toLowerCase() === 'group') {
        this.parseGroup();
      } else if (t.toLowerCase() === 'def') {
        this.parseDef();
      } else if (t.toLowerCase() === 'measure') {
        this.parseMeasure();
      } else {
        this.consume(); 
      }
    }
  }

  // --- PHASE 1: META ---

  private parseMetaBlock(isGlobal: boolean) {
    this.consume(); // 'meta'
    if (!this.match('{')) return;

    while (this.peek() !== '}' && this.tokenIndex < this.tokens.length) {
      let key = this.consume().replace(':', ''); 
      if (this.peek() === ':') this.consume(); // Consume explicit separator if present
      
      let val = this.consume();
      // Handle multi-word values like strings in quotes
      if (val.startsWith('"') && !val.endsWith('"')) {
          // This case should generally be handled by regex, but just in case
      }
      if (val.startsWith('[')) {
          while (!val.endsWith(']')) val += this.consume();
      }
      
      const cleanVal = val.replace(/"/g, '');
      const lowerKey = key.toLowerCase();

      if (isGlobal) {
          if (lowerKey === 'title') this.score.meta.title = cleanVal;
          else if (lowerKey === 'composer') this.score.meta.composer = cleanVal;
          else if (lowerKey === 'tempo') this.score.meta.tempo = parseInt(cleanVal, 10);
          else if (lowerKey === 'key') this.score.meta.key = cleanVal;
      }
      
      if (lowerKey === 'time') {
          const parts = cleanVal.split('/');
          const n = parseInt(parts[0], 10);
          const d = parseInt(parts[1], 10);
          if (!isNaN(n) && !isNaN(d)) {
              if (isGlobal) {
                  this.score.meta.timeSignature = [n, d];
                  this.currentNum = n;
                  this.currentDen = d;
              } else {
                  // Local meta update for time signature
                  this.currentNum = n;
                  this.currentDen = d;
              }
          }
      }

      if (this.peek() === ',') this.consume();
    }
    this.consume(); // '}'
  }

  // --- PHASE 2: DEFS ---

  private parseMacroDef() {
      this.consume(); // macro
      let sig = this.consume(); 
      let name = sig;
      let params: string[] = [];
      
      if (sig.includes('(')) {
          const parts = sig.split('(');
          name = parts[0];
          params = parts[1].replace(')', '').split(',').map(s => s.trim());
      }
      
      this.match('=');
      if (!this.match('{')) return;
      
      let balance = 1;
      let bodyTokens: string[] = [];
      while (balance > 0 && this.tokenIndex < this.tokens.length) {
          const t = this.consume();
          if (t === '{') balance++;
          else if (t === '}') balance--;
          if (balance > 0) bodyTokens.push(t);
      }
      
      this.macros[name] = { params, body: bodyTokens.join(' ') };
  }

  private parseGroup() {
      this.consume(); // group
      this.consume(); // label
      
      // Swallow attributes (symbol=brace)
      while (this.peek() !== '{') this.consume();
      this.consume(); 
      
      this.currentGroup = "Group"; 
      
      while (this.peek() !== '}' && this.tokenIndex < this.tokens.length) {
          if (this.peek().toLowerCase() === 'def') {
              this.parseDef();
          } else {
              this.consume();
          }
      }
      
      this.consume(); // }
      this.currentGroup = undefined;
  }

  private parseDef() {
      this.consume(); // def
      const id = this.consume();
      let label = id;
      
      // Check if next token is a string literal for label
      if (this.peek().startsWith('"')) {
          label = this.consume().replace(/"/g, '');
      }
      
      const inst: InstrumentDef = {
          id, label, style: StaffStyle.STANDARD, group: this.currentGroup
      };
      
      while (true) {
          const next = this.peek();
          if (['def', 'group', 'measure', 'meta', 'macro', '}', '{', '|'].includes(next.toLowerCase()) || next === '') break;
          // Check if next is likely an event start (like a note name), stop definition
          if (next.includes(':') && !next.includes('=')) break;

          let key = this.consume();
          let val = "";
          
          // Handle 'key=val' or 'key = val'
          if (this.peek() === '=') {
              this.consume(); // =
              val = this.consume().replace(/"/g, '');
          } else if (key.includes('=')) {
              const parts = key.split('=');
              key = parts[0];
              val = parts[1].replace(/"/g, '');
          } else {
              // Just a key without explicit value? Assume true or continue parsing next attr
              continue;
          }
          
          const k = key.toLowerCase();

          if (k === 'style') inst.style = val as StaffStyle;
          else if (k === 'clef') inst.clef = val;
          else if (k === 'transpose') inst.transpose = parseInt(val, 10);
          else if (k === 'patch') inst.patch = val;
          else if (k === 'vol') inst.vol = parseFloat(val);
          else if (k === 'pan') inst.pan = parseFloat(val);
          else if (k === 'map' && val === 'gm_kit') inst.map = GM_DRUM_MAP;
      }
      
      this.score.instruments.push(inst);
      this.globalCursors[id] = {};
  }

  // --- PHASE 3: LOGIC ---

  private parseMeasure() {
      this.consume(); // measure
      const range = this.consume(); 
      
      let startM = 0, endM = 0;
      if (range.includes('-')) {
          const p = range.split('-');
          startM = parseInt(p[0]); endM = parseInt(p[1]);
      } else {
          startM = parseInt(range); endM = startM;
      }
      
      if (!this.match('{')) return;
      
      // Capture block content
      const blockStart = this.tokenIndex;
      let balance = 1;
      while (balance > 0 && this.tokenIndex < this.tokens.length) {
          const t = this.consume();
          if (t === '{') balance++;
          if (t === '}') balance--;
      }
      const blockEnd = this.tokenIndex - 1;

      // Process measures in range
      for (let m = startM; m <= endM; m++) {
          // 1. Calculate Start Tick for this measure
          this.fillMeasureGap(m);
          const measureStartTick = this.score.measureStartTicks[m];

          // 2. Scan block for meta changes first (Time Signature)
          let tempIndex = blockStart;
          while (tempIndex < blockEnd) {
             const t = this.tokens[tempIndex];
             if (t.toLowerCase() === 'meta') {
                 const savedIndex = this.tokenIndex;
                 this.tokenIndex = tempIndex;
                 this.parseMetaBlock(false); // Parse local meta
                 this.score.timeSignatures.push({
                     measureIndex: m,
                     num: this.currentNum,
                     den: this.currentDen
                 });
                 this.tokenIndex = savedIndex; 
                 break; 
             }
             tempIndex++;
          }

          // 3. Process Content
          this.tokenIndex = blockStart;
          while (this.tokenIndex < blockEnd) {
              const t = this.peek();
              if (t.toLowerCase() === 'meta') {
                  this.parseMetaBlock(false); // Parse again to consume tokens
              } else {
                  const possibleId = t.replace(':', '');
                  if (this.score.instruments.some(i => i.id === possibleId)) {
                      this.parseInstrumentLogic(possibleId, measureStartTick);
                  } else {
                      this.consume(); // Skip unknown tokens
                  }
              }
          }
          
          // 4. Calculate duration
          const ticksInThisMeasure = (this.currentNum * (4 / this.currentDen)) * TICKS_PER_QUARTER;
          this.score.measureStartTicks[m + 1] = measureStartTick + ticksInThisMeasure;
          this.lastParsedMeasureIndex = m;
      }
      
      this.tokenIndex = blockEnd + 1;
  }

  private fillMeasureGap(targetM: number) {
      let m = this.lastParsedMeasureIndex + 1;
      if (this.lastParsedMeasureIndex === 0) m = 1;

      while (m <= targetM) {
          if (this.score.measureStartTicks[m] === undefined) {
              const prevStart = this.score.measureStartTicks[m - 1] || 0;
              const prevDur = (this.currentNum * (4 / this.currentDen)) * TICKS_PER_QUARTER;
              this.score.measureStartTicks[m] = prevStart + prevDur;
          }
          m++;
      }
  }

  private parseInstrumentLogic(instId: string, measureStartTick: number) {
      this.consume(); // ID
      if (this.peek() === ':') this.consume();
      
      const inst = this.score.instruments.find(i => i.id === instId)!;

      if (this.peek() === '{') {
          this.consume(); // {
          while (this.peek() !== '}' && this.tokenIndex < this.tokens.length) {
              const vToken = this.consume(); // v1:
              const voiceId = vToken.replace(':', '');
              if (this.peek() === ':') this.consume();
              
              if (!this.globalCursors[instId][voiceId]) {
                  this.globalCursors[instId][voiceId] = { octave: 4, duration: 1.0, tick: 0 };
              }
              this.parseVoiceStream(inst, voiceId, measureStartTick, '|');
              if (this.peek() === '|') this.consume();
          }
          this.consume(); // }
      } else {
          const voiceId = 'v1';
          if (!this.globalCursors[instId][voiceId]) {
              this.globalCursors[instId][voiceId] = { octave: 4, duration: 1.0, tick: 0 };
          }
          this.parseVoiceStream(inst, voiceId, measureStartTick, '|');
          if (this.peek() === '|') this.consume();
      }
  }

  private parseVoiceStream(inst: InstrumentDef, voiceId: string, baseTick: number, terminator: string) {
      let currentTick = 0; 
      
      while (this.peek() !== terminator && this.peek() !== '}' && this.tokenIndex < this.tokens.length) {
          const token = this.peek();
          if (token === ']') { this.consume(); continue; } // Barline closure
          
          if (token.startsWith('$')) {
              this.consume();
              this.handleMacro(token, inst, voiceId, baseTick, (dur) => currentTick += dur);
              continue;
          }
          
          this.parseEvent(inst, voiceId, baseTick, currentTick, (durTicks) => {
              currentTick += durTicks;
          });
      }
  }

  private handleMacro(token: string, inst: InstrumentDef, voiceId: string, baseTick: number, advanceTick: (t: number) => void) {
      let name = token.substring(1);
      let args: string[] = [];
      if (name.includes('(')) {
          const parts = name.split('(');
          name = parts[0];
          args = parts[1].replace(')', '').split(',');
      }
      
      const def = this.macros[name];
      if (!def) return; 
      
      let body = def.body;
      def.params.forEach((p, i) => {
          body = body.replace(new RegExp(`\\$${p}(?![a-zA-Z0-9_])`, 'g'), args[i] || '');
      });
      
      const macroTokens = body.match(REGEX_TOKEN) || [];
      
      this.tokens.splice(this.tokenIndex, 0, ...macroTokens);
  }

  private parseEvent(inst: InstrumentDef, voiceId: string, baseTick: number, relativeTick: number, onAdvance: (t: number) => void) {
      let token = this.consume();
      if (['|', '{', '}', ']'].includes(token)) return;

      const cursor = this.globalCursors[inst.id][voiceId];

      const attributes: Attribute[] = [];
      let core = token;
      
      if (token.includes('.')) {
          const parts = token.split(/\.(?=[a-zA-Z])/);
          core = parts[0];
          for (let i = 1; i < parts.length; i++) {
              attributes.push({ name: parts[i], args: [] });
          }
      }
      
      if (attributes.length > 0 && this.peek() === '(') {
          this.consume(); 
          const args: (string|number)[] = [];
          while (this.peek() !== ')') {
              const arg = this.consume();
              if (arg === ',') continue;
              args.push(isNaN(Number(arg)) ? arg.replace(/"/g, '') : Number(arg));
          }
          this.consume(); 
          attributes[attributes.length - 1].args = args;
      }
      
      const durSplit = core.split(':');
      const pitchStr = durSplit[0];
      const durStr = durSplit[1];

      if (durStr) {
          cursor.duration = this.parseDurationVal(durStr);
      }
      
      const ticks = cursor.duration * TICKS_PER_QUARTER;

      const event: NoteEvent = {
          type: 'note',
          pitches: [],
          duration: cursor.duration,
          tickStart: baseTick + relativeTick,
          tickEnd: baseTick + relativeTick + ticks,
          velocity: 0.8,
          instrumentId: inst.id,
          voiceId,
          modifiers: attributes
      };

      const isGrace = attributes.some(a => a.name === 'grace');
      if (isGrace) {
          event.duration = 0;
          event.tickEnd = event.tickStart;
      }

      if (pitchStr === 'r') {
          event.type = 'rest';
      } else if (pitchStr === 's') {
          event.type = 'rest'; 
      } else if (pitchStr.startsWith('[')) {
          event.type = 'chord';
          if (token === '[') {
              while (this.peek() !== ']') {
                  const p = this.consume();
                  this.resolvePitch(p, inst, cursor, event);
              }
              this.consume(); 
              if (this.peek().startsWith(':')) {
                  const d = this.consume().replace(':', '');
                  cursor.duration = this.parseDurationVal(d);
                  event.duration = cursor.duration;
                  event.tickEnd = event.tickStart + (cursor.duration * TICKS_PER_QUARTER);
              }
          } else {
              const inner = pitchStr.replace(/[\[\]]/g, '');
              const pTokens = inner.split(/\s+/);
              pTokens.forEach(p => this.resolvePitch(p, inst, cursor, event));
          }
      } else {
          this.resolvePitch(pitchStr, inst, cursor, event);
      }

      const volAttr = attributes.find(a => a.name === 'vol' || a.name === 'vel');
      if (volAttr && typeof volAttr.args[0] === 'number') {
          event.velocity = volAttr.args[0] / 127; 
      }

      this.score.timeline.push(event);

      if (!isGrace) {
          onAdvance(event.tickEnd - event.tickStart);
      }
  }

  private parseDurationVal(str: string): number {
      const dotCount = (str.match(/\./g) || []).length;
      const clean = str.replace(/\./g, '');
      const num = parseInt(clean, 10);
      
      if (isNaN(num) || num === 0) return 1.0; 

      const base = 4 / num;
      let val = base;
      if (dotCount === 1) val *= 1.5;
      if (dotCount === 2) val *= 1.75;
      return val;
  }

  private resolvePitch(p: string, inst: InstrumentDef, cursor: VoiceCursor, event: NoteEvent) {
      if (!p) return;
      
      if (inst.style === StaffStyle.TAB) {
          const parts = p.split('-');
          if (parts.length === 2) {
              const fret = parseInt(parts[0]);
              const str = parseInt(parts[1]);
              const tuning = inst.tuning || GUITAR_STD_TUNING;
              const stringPitch = tuning[tuning.length - str];
              if (stringPitch) {
                  const { midi } = this.parsePitchToMidi(stringPitch, 4);
                  event.pitches.push(`midi:${midi + fret}`);
              }
          }
      } else if (inst.style === StaffStyle.GRID) {
          const map = inst.map || GM_DRUM_MAP;
          const mapped = map[p];
          if (mapped) {
              const val = Array.isArray(mapped) ? mapped[1] : mapped;
              event.pitches.push(`midi:${val}`);
          }
      } else {
          const { midi, octave } = this.parsePitchToMidi(p, cursor.octave);
          cursor.octave = octave; 
          event.pitches.push(`midi:${midi}`);
      }
  }

  private parsePitchToMidi(pitch: string, lastOctave: number): { midi: number, octave: number } {
      const match = pitch.match(REGEX_PITCH);
      if (!match) return { midi: 60, octave: 4 };

      const step = match[1].toLowerCase();
      const acc = match[2] || '';
      const octStr = match[3];
      const octave = octStr ? parseInt(octStr, 10) : lastOctave;

      const baseMap: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
      let semitone = baseMap[step];

      if (acc.includes('#')) semitone += 1;
      if (acc.includes('b')) semitone -= 1;
      if (acc.includes('x')) semitone += 2;
      
      return { midi: (octave + 1) * 12 + semitone, octave };
  }

  private peek(): string { return this.tokens[this.tokenIndex] || ""; }
  private consume(): string { return this.tokens[this.tokenIndex++] || ""; }
  private match(val: string): boolean {
      if (this.peek() === val) { this.consume(); return true; }
      return false;
  }
}
