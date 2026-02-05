import { CompiledScore, InstrumentDef, MacroDef, NoteEvent, StaffStyle, VoiceCursor, DrumMapValue, Attribute, OmniMeta } from '../types';
import { GM_DRUM_MAP, GUITAR_STD_TUNING, TICKS_PER_QUARTER } from '../constants';

/**
 * OmniParser V2
 * Implements the OmniScore 2.0.0 Specification
 */

// Spec 2.5: Literals and Tokens
const REGEX_TOKEN = /([{}|,\[\]=():])|("[^"]*")|(\$[a-zA-Z_][a-zA-Z0-9_]*)|([a-zA-Z0-9_.\-+#]+)/g;
// Spec 6.1: Pitch Syntax
const REGEX_PITCH = /^([a-g])(qs|qf|tqs|tqf|x|bb|b|#|n)*(-?\d+)?$/i;

export class OmniParser {
  private source: string;
  private tokens: string[] = [];
  private tokenIndex = 0;
  
  private score: CompiledScore;
  
  // State Tracking
  private macros: Record<string, MacroDef> = {};
  private currentGroup: string | undefined;
  
  // Spec 5.2: Sticky State (Instrument -> Voice -> Cursor)
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
      durationTicks: 0
    };
  }

  public parse(): CompiledScore {
    // 1. Pre-process (Comments)
    const cleanCode = this.source.replace(/%%.*$/gm, '');
    
    // 2. Tokenize
    this.tokens = cleanCode.match(REGEX_TOKEN) || [];
    this.tokenIndex = 0;

    // 3. Root Block
    if (this.peek() === 'omniscore') {
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

    return this.score;
  }

  private parseBody() {
    while (this.tokenIndex < this.tokens.length && this.peek() !== '}') {
      const t = this.peek();
      
      if (t.toLowerCase() === 'meta') {
        this.parseMetaBlock();
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

  private parseMetaBlock() {
    this.consume(); // 'meta'
    if (!this.match('{')) return;

    while (this.peek() !== '}' && this.tokenIndex < this.tokens.length) {
      let key = this.consume().replace(':', ''); 
      if (this.peek() === ':') this.consume();
      
      let val = this.consume();
      if (val.startsWith('[')) {
          while (!val.endsWith(']')) val += this.consume();
      }
      
      const cleanVal = val.replace(/"/g, '');
      const lowerKey = key.toLowerCase();

      if (lowerKey === 'title') this.score.meta.title = cleanVal;
      else if (lowerKey === 'composer') this.score.meta.composer = cleanVal;
      else if (lowerKey === 'tempo') this.score.meta.tempo = parseInt(cleanVal, 10);
      else if (lowerKey === 'key') this.score.meta.key = cleanVal;
      else if (lowerKey === 'time') {
          const parts = cleanVal.split('/');
          const n = parseInt(parts[0], 10);
          const d = parseInt(parts[1], 10);
          if (!isNaN(n) && !isNaN(d)) this.score.meta.timeSignature = [n, d];
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
      
      this.currentGroup = "Group"; // Mark current group active
      
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
      
      if (this.peek().startsWith('"')) {
          label = this.consume().replace(/"/g, '');
      }
      
      const inst: InstrumentDef = {
          id, label, style: StaffStyle.STANDARD, group: this.currentGroup
      };
      
      while (true) {
          const next = this.peek();
          if (['def', 'group', 'measure', 'meta', 'macro', '}', '{'].includes(next.toLowerCase()) || next === '') break;
          
          const attr = this.consume();
          if (!attr.includes('=')) break;
          
          let [k, v] = attr.split('=');
          k = k.toLowerCase();
          v = v.replace(/"/g, '');

          if (k === 'style') inst.style = v as StaffStyle;
          else if (k === 'clef') inst.clef = v;
          else if (k === 'transpose') inst.transpose = parseInt(v, 10);
          else if (k === 'patch') inst.patch = v;
          else if (k === 'vol') inst.vol = parseFloat(v);
          else if (k === 'pan') inst.pan = parseFloat(v);
          else if (k === 'map' && v === 'gm_kit') inst.map = GM_DRUM_MAP;
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
      
      const blockStart = this.tokenIndex;
      let balance = 1;
      while (balance > 0 && this.tokenIndex < this.tokens.length) {
          const t = this.consume();
          if (t === '{') balance++;
          if (t === '}') balance--;
      }
      const blockEnd = this.tokenIndex - 1;
      
      const [num, den] = this.score.meta.timeSignature;
      const ticksPerMeasure = (num * (4/den)) * TICKS_PER_QUARTER;

      for (let m = startM; m <= endM; m++) {
          const measureStartTick = (m - 1) * ticksPerMeasure;
          this.tokenIndex = blockStart;
          
          while (this.tokenIndex < blockEnd) {
              const t = this.peek();
              if (t.toLowerCase() === 'meta') {
                  this.parseMetaBlock();
              } else {
                  const possibleId = t.replace(':', '');
                  if (this.score.instruments.some(i => i.id === possibleId)) {
                      this.parseInstrumentLogic(possibleId, measureStartTick);
                  } else {
                      this.consume();
                  }
              }
          }
      }
      this.tokenIndex = blockEnd + 1;
  }

  private parseInstrumentLogic(instId: string, measureStartTick: number) {
      this.consume(); // ID
      if (this.peek() === ':') this.consume();
      
      const inst = this.score.instruments.find(i => i.id === instId)!;

      // Spec 10: Voice Groups
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
          const token = this.consume();
          if (token === ']') continue; 
          
          if (token.startsWith('$')) {
              this.handleMacro(token, inst, voiceId, baseTick, (dur) => currentTick += dur);
              continue;
          }
          
          this.parseEvent(token, inst, voiceId, baseTick, currentTick, (durTicks) => {
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
          body = body.replace(new RegExp(`\\$${p}\\b`, 'g'), args[i] || '');
      });
      
      const macroTokens = body.match(REGEX_TOKEN) || [];
      for (const t of macroTokens) {
          this.parseEvent(t, inst, voiceId, baseTick, 0, advanceTick); 
      }
  }

  private parseEvent(token: string, inst: InstrumentDef, voiceId: string, baseTick: number, relativeTick: number, onAdvance: (t: number) => void) {
      if (['|', '{', '}', ']'].includes(token)) return;

      const cursor = this.globalCursors[inst.id][voiceId];

      // Attribute Split: c4:4.vol(50).stacc
      // Regex split by dot not preceded by digit/colon
      const parts = token.split(/(?<!:[\d])\./);
      const core = parts[0];
      const attrStrings = parts.slice(1);
      
      const attributes: Attribute[] = attrStrings.map(s => {
          if (s.includes('(')) {
              const [name, argStr] = s.split('(');
              const args = argStr.replace(')', '').split(',').map(a => isNaN(Number(a)) ? a : Number(a));
              return { name, args };
          }
          return { name: s, args: [] };
      });

      const durSplit = core.split(':');
      const pitchStr = durSplit[0];
      const durStr = durSplit[1];

      // Sticky Duration
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
          const inner = pitchStr.replace(/[\[\]]/g, '');
          const pTokens = inner.split(/\s+/);
          pTokens.forEach(p => this.resolvePitch(p, inst, cursor, event));
      } else {
          this.resolvePitch(pitchStr, inst, cursor, event);
      }

      // Vol override
      const volAttr = attributes.find(a => a.name === 'vol' || a.name === 'vel');
      if (volAttr && typeof volAttr.args[0] === 'number') {
          event.velocity = volAttr.args[0] / 127; 
      }

      this.score.timeline.push(event);

      if (!isGrace) {
          onAdvance(ticks);
      }
  }

  private parseDurationVal(str: string): number {
      const dotCount = (str.match(/\./g) || []).length;
      const clean = str.replace(/\./g, '');
      const base = 4 / parseInt(clean, 10);
      let val = base;
      if (dotCount === 1) val *= 1.5;
      if (dotCount === 2) val *= 1.75;
      return val;
  }

  private resolvePitch(p: string, inst: InstrumentDef, cursor: VoiceCursor, event: NoteEvent) {
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
          cursor.octave = octave; // Sticky Octave
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

      if (acc === '#') semitone += 1;
      if (acc === 'b') semitone -= 1;
      if (acc === 'x') semitone += 2;
      if (acc === 'bb') semitone -= 2;
      
      return { midi: (octave + 1) * 12 + semitone, octave };
  }

  private peek(): string { return this.tokens[this.tokenIndex] || ""; }
  private consume(): string { return this.tokens[this.tokenIndex++] || ""; }
  private match(val: string): boolean {
      if (this.peek() === val) { this.consume(); return true; }
      return false;
  }
}
