import React, { useEffect, useRef, useState } from 'react';
import * as Vex from 'vexflow';
import { CompiledScore, NoteEvent, InstrumentDef } from '../types';
import { TICKS_PER_QUARTER } from '../constants';

interface Props {
  score: CompiledScore | null;
  currentTick: number;
}

interface CursorPos {
    systemIndex: number;
    x: number;
    y: number;
    height: number;
}

interface MeasureLayout {
    index: number;
    x: number;
    width: number;
    tickStart: number;
    tickEnd: number;
    ts: [number, number];
}

interface SystemLayout {
    startIndex: number;
    endIndex: number;
    measures: MeasureLayout[];
    y: number;
}

const ScoreVisualizer: React.FC<Props> = ({ score, currentTick }) => {
  const [cursorPos, setCursorPos] = useState<CursorPos | null>(null);
  
  const systemsRegistry = useRef<SystemLayout[]>([]);

  // --- LAYOUT CONSTANTS ---
  const PAGE_WIDTH = 900; 
  const LEFT_MARGIN = 60;
  const RIGHT_MARGIN = 20;
  const SYSTEM_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN;
  const STAVE_SPACING = 120;
  const MEASURES_PER_SYSTEM = 3;

  // --- CALCULATE SYSTEMS SAFEGUARDS ---
  let totalMeasures = 0;
  let systemCount = 0;
  let measureLayouts: MeasureLayout[] = [];

  if (score) {
      const maxMeasureKey = Math.max(...Object.keys(score.measureStartTicks).map(Number));
      totalMeasures = maxMeasureKey || 1;
      
      if (score.measureStartTicks[totalMeasures] >= score.durationTicks && totalMeasures > 1) {
         // It might be an empty end marker, but keep it for now
      }

      systemCount = Math.ceil(totalMeasures / MEASURES_PER_SYSTEM);

      let currentTS = score.meta.timeSignature;
      
      for(let m=1; m<=totalMeasures; m++) {
          const tsEvent = score.timeSignatures.find(t => t.measureIndex === m);
          if (tsEvent) currentTS = [tsEvent.num, tsEvent.den];
          
          const startTick = score.measureStartTicks[m] || 0;
          const endTick = score.measureStartTicks[m+1] || (startTick + (currentTS[0] * (4/currentTS[1]) * TICKS_PER_QUARTER));
          
          measureLayouts.push({
              index: m,
              x: 0,
              width: 0,
              tickStart: startTick,
              tickEnd: endTick,
              ts: currentTS
          });
      }
  }

  // --- CURSOR EFFECT ---
  useEffect(() => {
     if (!score || measureLayouts.length === 0) {
         setCursorPos(null);
         return;
     }

     const currentMeasure = measureLayouts.find(m => currentTick >= m.tickStart && currentTick < m.tickEnd);
     
     if (currentMeasure) {
         const sysIdx = Math.floor((currentMeasure.index - 1) / MEASURES_PER_SYSTEM);
         const sysLayout = systemsRegistry.current[sysIdx];
         
         if (sysLayout) {
             const measureInSys = sysLayout.measures.find(m => m.index === currentMeasure.index);
             if (measureInSys) {
                 const duration = currentMeasure.tickEnd - currentMeasure.tickStart;
                 const progress = (currentTick - currentMeasure.tickStart) / duration;
                 const x = measureInSys.x + (progress * measureInSys.width) + 15; 
                 
                 setCursorPos({
                     systemIndex: sysIdx,
                     x: x,
                     y: 0,
                     height: score.instruments.length * STAVE_SPACING + 50
                 });
                 return;
             }
         }
     }
     setCursorPos(null);
  }, [currentTick, score]);

  return (
    <div className="w-full h-full bg-[#52525b] overflow-auto flex flex-col items-center p-8 gap-8">
        <div id="printable-score" className="w-[900px] bg-white shadow-2xl min-h-[1000px] p-10 flex flex-col transition-all">
            {/* Header */}
            {score ? (
                <>
                <div className="text-center mb-10">
                    <h1 className="text-3xl font-bold font-serif text-black">{score.meta.title}</h1>
                    <p className="text-md italic text-gray-600 font-serif mt-1">{score.meta.composer}</p>
                </div>

                {Array.from({ length: systemCount }).map((_, sysIdx) => {
                    const startIndex = (sysIdx * MEASURES_PER_SYSTEM) + 1;
                    const slice = measureLayouts.slice(sysIdx * MEASURES_PER_SYSTEM, (sysIdx + 1) * MEASURES_PER_SYSTEM);
                    
                    return (
                        <div key={sysIdx} className="score-system relative w-full mb-12">
                            <SystemRenderer 
                                score={score}
                                measureLayouts={slice}
                                width={PAGE_WIDTH}
                                staveSpacing={STAVE_SPACING}
                                leftMargin={LEFT_MARGIN}
                                systemWidth={SYSTEM_WIDTH}
                                showLabels={sysIdx === 0}
                                onRegister={(layout) => {
                                    systemsRegistry.current[sysIdx] = layout;
                                }}
                            />
                            {cursorPos && cursorPos.systemIndex === sysIdx && (
                                <div className="absolute w-0.5 bg-blue-500/50 z-10 pointer-events-none transition-all duration-75"
                                    style={{ 
                                        left: cursorPos.x, 
                                        top: 20,
                                        height: cursorPos.height, 
                                        boxShadow: "0 0 4px rgba(59, 130, 246, 0.5)" 
                                    }} 
                                />
                            )}
                        </div>
                    );
                })}
                </>
            ) : (
                <div className="flex-1 flex items-center justify-center text-zinc-400 font-serif italic">
                    No score loaded. Compile source code to view.
                </div>
            )}
        </div>
    </div>
  );
};

// --- SUB-COMPONENT: SYSTEM RENDERER ---
interface SystemProps {
    score: CompiledScore;
    measureLayouts: MeasureLayout[];
    width: number;
    staveSpacing: number;
    leftMargin: number;
    systemWidth: number;
    showLabels: boolean;
    onRegister: (layout: SystemLayout) => void;
}

const SystemRenderer: React.FC<SystemProps> = ({ 
    score, measureLayouts, width, staveSpacing, leftMargin, systemWidth, showLabels, onRegister 
}) => {
    const divRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!divRef.current || measureLayouts.length === 0) return;
        const div = divRef.current;
        while (div.firstChild) div.removeChild(div.firstChild);

        const VF = Vex;
        const renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
        
        const instruments = score.instruments;
        const systemHeight = instruments.length * staveSpacing + 50; 
        renderer.resize(width, systemHeight);
        const context = renderer.getContext();
        
        context.setFont("Libre Baskerville", 10).setBackgroundFillStyle("transparent");
        context.setFillStyle("#000000"); 
        context.setStrokeStyle("#000000");

        const measureCount = measureLayouts.length;
        const measureWidth = systemWidth / measureCount;
        
        const registeredMeasures = measureLayouts.map((m, i) => ({
            ...m,
            x: leftMargin + (i * measureWidth),
            width: measureWidth
        }));

        onRegister({
            startIndex: measureLayouts[0].index,
            endIndex: measureLayouts[measureLayouts.length-1].index,
            measures: registeredMeasures,
            y: 0
        });

        const systemStaves: Vex.Stave[] = [];

        // 1. Draw Staves
        for (let i = 0; i < measureCount; i++) {
            const mLayout = measureLayouts[i];
            const x = leftMargin + (i * measureWidth);
            
            instruments.forEach((inst, instIdx) => {
                const y = 20 + (instIdx * staveSpacing); 
                const stave = new VF.Stave(x, y, measureWidth);
                
                if (i === 0) {
                    stave.addClef(inst.clef || "treble");
                    stave.addKeySignature(score.meta.key || "C");
                    if (showLabels) stave.setText(inst.label, VF.Modifier.Position.LEFT);
                }

                // Check for TS change
                const isSystemStart = i === 0;
                const tsChanged = score.timeSignatures.some(t => t.measureIndex === mLayout.index);
                
                if (isSystemStart || tsChanged) {
                     stave.addTimeSignature(`${mLayout.ts[0]}/${mLayout.ts[1]}`);
                }

                stave.setContext(context).draw();
                
                if (i === 0) systemStaves.push(stave);

                // 2. Draw Notes
                drawMeasureNotes(context, stave, score, inst, mLayout);
            });
            
            // Measure Numbers
            context.save();
            context.setFont("Arial", 8, "bold");
            context.fillText((mLayout.index).toString(), x, 20); 
            context.restore();
        }

        // 3. Draw Braces (Only on first column)
        drawBraces(context, systemStaves, instruments);

    }, [score, measureLayouts]); 

    return <div ref={divRef} />;
};

function drawBraces(ctx: any, staves: Vex.Stave[], instruments: InstrumentDef[]) {
    const VF = Vex;
    let currentGroup: string | null | undefined = null;
    let groupStart = -1;

    instruments.forEach((inst, i) => {
        if (inst.group && inst.group !== currentGroup) {
            currentGroup = inst.group;
            groupStart = i;
        }
        
        const nextInst = instruments[i + 1];
        const endOfGroup = !nextInst || nextInst.group !== currentGroup;
        
        if (currentGroup && endOfGroup && groupStart !== -1) {
            const top = staves[groupStart];
            const bot = staves[i];
            new VF.StaveConnector(top, bot).setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
            new VF.StaveConnector(top, bot).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
            groupStart = -1;
            currentGroup = null;
        }
    });
    
    if (staves.length > 1) {
        const top = staves[0];
        const bottom = staves[staves.length - 1];
        if (top && bottom) {
            new VF.StaveConnector(top, bottom).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        }
    }
}

function drawMeasureNotes(ctx: any, stave: Vex.Stave, score: CompiledScore, inst: InstrumentDef, mLayout: MeasureLayout) {
    const VF = Vex;
    
    const events = score.timeline.filter(e => 
        e.instrumentId === inst.id && e.tickStart >= mLayout.tickStart && e.tickStart < mLayout.tickEnd
    );

    const voicesData: Record<string, NoteEvent[]> = {};
    events.forEach(e => {
        const vid = e.voiceId || 'v1';
        if (!voicesData[vid]) voicesData[vid] = [];
        voicesData[vid].push(e);
    });

    const vexVoices: Vex.Voice[] = [];
    const allBeams: Vex.Beam[] = [];
    
    Object.keys(voicesData).forEach(vid => {
        const vEvents = voicesData[vid].sort((a,b) => a.tickStart - b.tickStart);
        const notes: Vex.StaveNote[] = [];
        
        const tickGroups: Record<number, NoteEvent[]> = {};
        vEvents.forEach(e => {
            if(!tickGroups[e.tickStart]) tickGroups[e.tickStart] = [];
            tickGroups[e.tickStart].push(e);
        });
        
        Object.keys(tickGroups).map(t => Number(t)).sort((a,b)=>a-b).forEach(t => {
            const grp = tickGroups[t];
            const first = grp[0];
            
            const keys = grp.flatMap(e => 
                e.type === 'rest' 
                ? (inst.clef === 'bass' ? ["d/3"] : ["b/4"]) 
                : e.pitches.map(p => {
                    const m = parseInt(p.split(':')[1], 10);
                    return midiToKey(m);
                })
            );
            
            const uniqueKeys = Array.from(new Set(keys));
            if(uniqueKeys.length === 0) uniqueKeys.push("b/4");

            const durStr = ticksToDuration(first.duration * TICKS_PER_QUARTER);
            
            const note = new VF.StaveNote({
                keys: uniqueKeys,
                duration: first.type === 'rest' ? durStr + "r" : durStr,
                clef: inst.clef || "treble",
                autoStem: true,
                stemDirection: vid === 'v1' ? 1 : -1
            });
            
            if(durStr.includes('d')) VF.Dot.buildAndAttach([note]);
            
            if(first.type !== 'rest') {
                uniqueKeys.forEach((k, idx) => {
                    if(k.includes('#')) note.addModifier(new VF.Accidental('#'), idx);
                    if(k.includes('b')) note.addModifier(new VF.Accidental('b'), idx);
                });
            }
            
            first.modifiers.forEach(m => {
               if(m.name === 'stacc') note.addModifier(new VF.Articulation('a.').setPosition(3), 0); 
               if(m.name === 'acc') note.addModifier(new VF.Articulation('a>').setPosition(3), 0); 
               if(m.name === 'fermata') note.addModifier(new VF.Articulation('a@a').setPosition(3), 0); 
            });

            notes.push(note);
        });

        if (notes.length > 0) {
            const voice = new VF.Voice({ numBeats: mLayout.ts[0], beatValue: mLayout.ts[1] });
            voice.setMode(VF.Voice.Mode.SOFT);
            voice.addTickables(notes);
            vexVoices.push(voice);
            
            // Auto Beam
            try {
                const beams = VF.Beam.generateBeams(notes);
                allBeams.push(...beams);
            } catch (e) {
                console.warn("Auto-beaming failed", e);
            }
        }
    });

    if (vexVoices.length > 0) {
        new VF.Formatter().joinVoices(vexVoices).format(vexVoices, stave.getWidth() - 20); 
        vexVoices.forEach(v => {
            v.setStave(stave);
            v.draw(ctx);
        });
        
        allBeams.forEach(b => {
            b.setContext(ctx).draw();
        });
    }
}

const midiToKey = (midi: number) => {
    const names = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
    const oct = Math.floor(midi / 12) - 1;
    const idx = midi % 12;
    return `${names[idx]}/${oct}`;
};

const ticksToDuration = (ticks: number) => {
    const q = TICKS_PER_QUARTER;
    const t = Math.round(ticks);
    
    if(Math.abs(t - q*4) < 50) return "w";
    if(Math.abs(t - q*3) < 50) return "hd";
    if(Math.abs(t - q*2) < 50) return "h";
    if(Math.abs(t - q*1.5) < 50) return "qd";
    if(Math.abs(t - q) < 50) return "q";
    if(Math.abs(t - q*0.75) < 50) return "8d";
    if(Math.abs(t - q*0.5) < 50) return "8";
    if(Math.abs(t - q*0.25) < 50) return "16";
    if(Math.abs(t - q*0.125) < 50) return "32";
    
    return "q"; // Fallback
};

export default ScoreVisualizer;
