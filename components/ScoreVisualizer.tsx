import React, { useEffect, useRef, useState } from 'react';
import * as Vex from 'vexflow';
import { CompiledScore, NoteEvent, InstrumentDef } from '../types';
import { TICKS_PER_QUARTER } from '../constants';

interface Props {
  score: CompiledScore | null;
  currentTick: number;
}

interface CursorPos {
    x: number;
    y: number;
    height: number;
}

const ScoreVisualizer: React.FC<Props> = ({ score, currentTick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Vex.Renderer | null>(null);
  const [cursorPos, setCursorPos] = useState<CursorPos | null>(null);
  
  const measureRegistry = useRef<Record<number, { x: number, y: number, width: number, systemY: number }>>({});

  useEffect(() => {
    if (!score || !containerRef.current) return;

    const div = containerRef.current;
    while (div.firstChild) div.removeChild(div.firstChild);

    // VexFlow 4.x: Classes are exported directly on Vex.
    // 'Flow' namespace is deprecated/removed in types.
    const VF = Vex;
    const PAGE_WIDTH = 800; 
    const renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
    
    // Layout Constants
    const LEFT_MARGIN = 60;
    const TOP_MARGIN = 80;
    const SYSTEM_WIDTH = PAGE_WIDTH - 40;
    const STAVE_SPACING = 110;
    const SYSTEM_SPACING = 60;
    const MEASURES_PER_SYSTEM = 3; 
    
    // Metadata
    let num = score.meta.timeSignature[0];
    let den = score.meta.timeSignature[1];
    if (isNaN(num) || isNaN(den) || den === 0) { num = 4; den = 4; }

    const ticksPerMeasure = (num * (4 / den)) * TICKS_PER_QUARTER;
    const totalMeasures = Math.ceil(score.durationTicks / ticksPerMeasure) || 1;
    
    const instruments = score.instruments;
    const systemHeight = instruments.length * STAVE_SPACING;
    const totalSystems = Math.ceil(totalMeasures / MEASURES_PER_SYSTEM);
    const totalHeight = TOP_MARGIN + (totalSystems * (systemHeight + SYSTEM_SPACING));
    
    renderer.resize(PAGE_WIDTH, totalHeight);
    const context = renderer.getContext();
    context.setFont("Libre Baskerville", 10).setBackgroundFillStyle("transparent");
    context.setFillStyle("#000000"); 
    context.setStrokeStyle("#000000");

    // Title
    context.save();
    context.setFont("Libre Baskerville", 22, "bold");
    const titleWidth = context.measureText(score.meta.title).width;
    context.fillText(score.meta.title, (PAGE_WIDTH / 2) - (titleWidth / 2), 40);
    context.setFont("Libre Baskerville", 12, "italic");
    const compWidth = context.measureText(score.meta.composer).width;
    context.fillText(score.meta.composer, PAGE_WIDTH - compWidth - 20, 60);
    context.restore();

    measureRegistry.current = {};

    for (let m = 0; m < totalMeasures; m++) {
        const systemIndex = Math.floor(m / MEASURES_PER_SYSTEM);
        const measureInSystem = m % MEASURES_PER_SYSTEM;
        
        const startX = LEFT_MARGIN;
        const measureWidth = (SYSTEM_WIDTH - LEFT_MARGIN) / MEASURES_PER_SYSTEM;
        const x = startX + (measureInSystem * measureWidth);
        const startY = TOP_MARGIN + (systemIndex * (systemHeight + SYSTEM_SPACING));
        
        measureRegistry.current[m] = { x, y: startY, width: measureWidth, systemY: startY };

        const measureStartTick = m * ticksPerMeasure;
        const measureEndTick = (m + 1) * ticksPerMeasure;

        const measureStaves: Vex.Stave[] = [];

        instruments.forEach((inst, i) => {
            const y = startY + (i * STAVE_SPACING);
            const stave = new VF.Stave(x, y, measureWidth);
            
            if (measureInSystem === 0) {
                stave.addClef(inst.clef || "treble");
                stave.addKeySignature(score.meta.key || "C");
                if (m === 0) stave.addTimeSignature(`${num}/${den}`);
                stave.setText(inst.label, VF.Modifier.Position.LEFT);
            } else if (m === 0) {
                 stave.addTimeSignature(`${num}/${den}`);
            }

            stave.setContext(context).draw();
            measureStaves.push(stave);

            // Spec 10: Multi-Voice Handling
            const instEvents = score.timeline.filter(e => 
                e.instrumentId === inst.id && 
                e.tickStart >= measureStartTick && 
                e.tickStart < measureEndTick
            );

            // Group by Voice ID
            const voicesData: Record<string, NoteEvent[]> = {};
            instEvents.forEach(e => {
                const vid = e.voiceId || 'v1';
                if (!voicesData[vid]) voicesData[vid] = [];
                voicesData[vid].push(e);
            });

            const vexVoices: Vex.Voice[] = [];
            
            Object.keys(voicesData).forEach(voiceId => {
                const events = voicesData[voiceId];
                events.sort((a,b) => a.tickStart - b.tickStart);

                const staveNotes: Vex.StaveNote[] = [];
                const eventsByTick: Record<number, NoteEvent[]> = {};
                
                events.forEach(e => {
                     if (!eventsByTick[e.tickStart]) eventsByTick[e.tickStart] = [];
                     eventsByTick[e.tickStart].push(e);
                });
                
                Object.keys(eventsByTick).map(Number).sort((a,b)=>a-b).forEach(tick => {
                    const group = eventsByTick[tick];
                    const first = group[0];
                    
                    const keys = group.flatMap(e => 
                        e.type === 'rest' 
                            ? (inst.clef === 'bass' ? ["d/3"] : ["b/4"]) 
                            : e.pitches.map(p => {
                                const midi = parseInt(p.split(':')[1]);
                                return midiToKey(midi);
                            })
                    );
                    
                    const uniqueKeys = Array.from(new Set(keys));
                    const duration = ticksToDuration(first.duration * TICKS_PER_QUARTER);
                    
                    const note = new VF.StaveNote({
                        keys: uniqueKeys,
                        duration: first.type === 'rest' ? duration + "r" : duration,
                        clef: inst.clef || "treble",
                        auto_stem: true,
                        stem_direction: voiceId === 'v1' ? 1 : -1 
                    });

                    if (duration.includes('d')) VF.Dot.buildAndAttach([note]);
                    
                    if (first.type !== 'rest') {
                         uniqueKeys.forEach((key, idx) => {
                             if (key.includes("#")) note.addModifier(new VF.Accidental("#"), idx);
                             if (key.includes("b")) note.addModifier(new VF.Accidental("b"), idx);
                         });
                    }

                    first.modifiers.forEach(attr => {
                        if (attr.name === 'stacc') note.addModifier(new VF.Articulation('a.').setPosition(3), 0);
                        if (attr.name === 'acc') note.addModifier(new VF.Articulation('a>').setPosition(3), 0);
                        if (attr.name === 'fermata') note.addModifier(new VF.Articulation('a@a').setPosition(3), 0);
                    });

                    staveNotes.push(note);
                });

                if (staveNotes.length > 0) {
                     const voice = new VF.Voice({ num_beats: num, beat_value: den });
                     voice.setMode(VF.Voice.Mode.SOFT);
                     voice.addTickables(staveNotes);
                     vexVoices.push(voice);
                }
            });

            if (vexVoices.length > 0) {
                 const formatter = new VF.Formatter().joinVoices(vexVoices).format(vexVoices, measureWidth - 20);
                 vexVoices.forEach(v => v.draw(context, stave));
            }
        });

        // Spec 4.5: Group Braces
        if (measureInSystem === 0) {
            let currentGroup = null;
            let groupStartIndex = -1;
            
            instruments.forEach((inst, idx) => {
                if (inst.group && inst.group !== currentGroup) {
                    currentGroup = inst.group;
                    groupStartIndex = idx;
                }
                const nextInst = instruments[idx + 1];
                const endOfGroup = !nextInst || nextInst.group !== currentGroup;
                
                if (currentGroup && endOfGroup && groupStartIndex !== -1) {
                    const startStave = measureStaves[groupStartIndex];
                    const endStave = measureStaves[idx];
                    
                    new VF.StaveConnector(startStave, endStave).setType(VF.StaveConnector.type.BRACE).setContext(context).draw();
                    new VF.StaveConnector(startStave, endStave).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(context).draw();

                    currentGroup = null;
                    groupStartIndex = -1;
                }
            });
            
            if (instruments.length > 1) {
                new VF.StaveConnector(measureStaves[0], measureStaves[measureStaves.length-1])
                    .setType(VF.StaveConnector.type.SINGLE_LEFT)
                    .setContext(context).draw();
            }
            
            context.save();
            context.setFont("Arial", 8, "bold");
            context.fillText((m+1).toString(), x, startY - 10);
            context.restore();
        }
    }
    rendererRef.current = renderer;
  }, [score]);

  const midiToKey = (midi: number): string => {
        const noteNames = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
        const octave = Math.floor(midi / 12) - 1;
        const noteIndex = midi % 12;
        return `${noteNames[noteIndex]}/${octave}`;
  };

  const ticksToDuration = (ticks: number): string => {
        const quarter = TICKS_PER_QUARTER;
        const t = Math.round(ticks); 
        if (Math.abs(t - quarter * 4) < 100) return "w";
        if (Math.abs(t - quarter * 3) < 100) return "hd";
        if (Math.abs(t - quarter * 2) < 100) return "h";
        if (Math.abs(t - quarter * 1.5) < 100) return "qd";
        if (Math.abs(t - quarter) < 50) return "q";
        if (Math.abs(t - quarter * 0.75) < 50) return "8d";
        if (Math.abs(t - quarter * 0.5) < 50) return "8";
        if (Math.abs(t - quarter * 0.25) < 50) return "16";
        return "q";
  };

  useEffect(() => {
     if (!score) return;
     let num = score.meta.timeSignature[0];
     let den = score.meta.timeSignature[1];
     if (isNaN(num) || den === 0) { num = 4; den = 4; }
     
     const ticksPerMeasure = (num * (4 / den)) * TICKS_PER_QUARTER;
     const measureIndex = Math.floor(currentTick / ticksPerMeasure);
     const ticksInMeasure = currentTick % ticksPerMeasure;
     const percent = ticksInMeasure / ticksPerMeasure;
     
     const layout = measureRegistry.current[measureIndex];
     
     if (layout) {
         setCursorPos({
             x: layout.x + (layout.width * percent) + 15,
             y: layout.systemY,
             height: score.instruments.length * 110 
         });
     } else {
         setCursorPos(null);
     }
  }, [currentTick, score]);

  return (
    <div className="w-full h-full bg-[#52525b] overflow-auto flex justify-center p-8">
       <div id="printable-score" className="bg-white shadow-2xl relative transition-transform duration-200" style={{ width: 800, minHeight: 1000 }}>
           <div ref={containerRef} />
           {cursorPos && (
             <div className="absolute w-0.5 bg-blue-500/50 z-10 pointer-events-none transition-all duration-75"
                style={{ left: cursorPos.x, top: cursorPos.y, height: cursorPos.height, boxShadow: "0 0 4px rgba(59, 130, 246, 0.5)" }} />
           )}
       </div>
    </div>
  );
};

export default ScoreVisualizer;