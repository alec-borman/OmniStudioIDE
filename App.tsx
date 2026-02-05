import React, { useState, useEffect, useRef } from 'react';
import { OmniParser } from './services/omniParser';
import { AudioEngine } from './services/audioEngine';
import ScoreVisualizer from './components/ScoreVisualizer';
import { SAMPLE_CODE } from './constants';
import { CompiledScore } from './types';

// Icons
const PlayIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>;
const PauseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>;
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16"></rect></svg>;
const PrintIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>;
const CompileIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>;

const App: React.FC = () => {
  const [code, setCode] = useState(SAMPLE_CODE);
  const [score, setScore] = useState<CompiledScore | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTick, setCurrentTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [autoCompile, setAutoCompile] = useState(false); // New feature: Auto compile toggle
  
  const engineRef = useRef<AudioEngine>(new AudioEngine());
  const compileTimerRef = useRef<number | null>(null);

  useEffect(() => {
    handleCompile();
    
    engineRef.current.onTick = (tick) => setCurrentTick(tick);
    engineRef.current.onStop = () => setIsPlaying(false);

    return () => {
      engineRef.current.stop();
    };
  }, []);

  // Auto-compile debounce
  useEffect(() => {
      if (!autoCompile) return;
      if (compileTimerRef.current) clearTimeout(compileTimerRef.current);
      
      compileTimerRef.current = window.setTimeout(() => {
          handleCompile();
      }, 1000);
      
      return () => { if (compileTimerRef.current) clearTimeout(compileTimerRef.current); };
  }, [code, autoCompile]);

  const handleCompile = () => {
    try {
      setError(null);
      const parser = new OmniParser(code);
      const compiled = parser.parse();
      setScore(compiled);
      engineRef.current.loadScore(compiled);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      engineRef.current.pause();
    } else {
      engineRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleStop = () => {
    engineRef.current.stop();
    setIsPlaying(false);
  };

  const handlePrint = () => {
      window.print();
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* HEADER */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900 select-none">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
            OS
          </div>
          <div>
             <h1 className="font-bold text-sm tracking-wide">OMNISCORE</h1>
             <p className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">Professional Engraving Env.</p>
          </div>
        </div>
        
        {/* Playback Controls */}
        <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-2 bg-zinc-950/50 p-1 rounded-full border border-zinc-800">
           <button 
             onClick={togglePlay}
             className={`w-10 h-10 flex items-center justify-center rounded-full transition-all ${isPlaying ? 'bg-zinc-800 text-red-400 hover:text-red-300' : 'bg-white text-black hover:bg-zinc-200'}`}
           >
             {isPlaying ? <PauseIcon /> : <PlayIcon />}
           </button>
           <button 
             onClick={handleStop}
             className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
           >
             <StopIcon />
           </button>
           
           {score && (
             <div className="px-3 py-1 flex flex-col items-start border-l border-zinc-800 ml-1">
                 <span className="text-[10px] text-zinc-500 font-mono">MEASURE</span>
                 <span className="text-xs font-mono text-zinc-300">
                     {Math.floor(currentTick / (960 * 4)) + 1}
                 </span>
             </div>
           )}
        </div>

        <div className="flex items-center gap-3">
           <button 
             onClick={() => setAutoCompile(!autoCompile)}
             className={`text-xs px-2 py-1 rounded border transition-colors ${autoCompile ? 'border-green-800 bg-green-900/20 text-green-400' : 'border-zinc-800 text-zinc-500'}`}
           >
             Auto-Compile: {autoCompile ? 'ON' : 'OFF'}
           </button>
           <button 
             onClick={handlePrint}
             className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium rounded text-zinc-200 transition-colors border border-zinc-700"
           >
             <PrintIcon /> Print PDF
           </button>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* EDITOR (Left) */}
        <div className="w-[40%] flex flex-col border-r border-zinc-800 editor-pane">
          <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
             <div className="flex items-center gap-2">
                 <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                 <span className="text-xs font-mono text-zinc-400">score.omni</span>
             </div>
             <button 
               onClick={handleCompile}
               className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
             >
               <CompileIcon /> Compile
             </button>
          </div>
          
          <div className="flex-1 relative group">
            <textarea 
               value={code}
               onChange={(e) => setCode(e.target.value)}
               spellCheck={false}
               className="absolute inset-0 w-full h-full bg-zinc-950 p-6 font-mono text-sm leading-6 resize-none outline-none text-zinc-300 selection:bg-indigo-900/50"
               style={{ tabSize: 2 }}
            />
            
            {/* Error Overlay */}
            {error && (
                <div className="absolute bottom-4 left-4 right-4 bg-red-900/90 backdrop-blur border border-red-700 text-white p-3 rounded shadow-xl text-xs font-mono flex items-start gap-2 animate-in fade-in slide-in-from-bottom-2">
                    <span className="font-bold">ERROR:</span> {error}
                </div>
            )}
          </div>
        </div>

        {/* PREVIEW (Right) */}
        <div className="flex-1 flex flex-col bg-zinc-900 overflow-hidden relative">
           {/* Visualizer Scroll Area */}
           <div className="flex-1 overflow-auto relative bg-[#2e2e31]">
              <div className="min-h-full p-8 flex justify-center items-start">
                 <ScoreVisualizer score={score} currentTick={currentTick} />
              </div>
           </div>

           {/* Footer Info */}
           <div className="h-8 bg-zinc-950 border-t border-zinc-800 flex items-center px-4 justify-between text-[10px] text-zinc-500 font-mono select-none">
              <div className="flex gap-4">
                  <span>READY</span>
                  {score && <span>{score.instruments.length} INSTRUMENTS</span>}
                  {score && <span>{(score.durationTicks / 960).toFixed(1)} QN DURATION</span>}
              </div>
              <div>
                  OMNISCORE ENGINE V1.2
              </div>
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;
