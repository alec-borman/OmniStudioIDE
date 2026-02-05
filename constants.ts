export const DEFAULT_TEMPO = 120;
export const TICKS_PER_QUARTER = 1920; // Spec 5.6: 1920 PPQ Resolution

export const GM_DRUM_MAP: Record<string, number> = {
  'k': 36, 's': 38, 'ss': 37, 'h': 42, 'ho': 46, 
  'ph': 44, 'c': 49, 'r': 51, 'rb': 53, 't1': 50, 't2': 47, 't3': 43
};

export const GUITAR_STD_TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

export const SAMPLE_CODE = `omniscore {
  %% ==========================================================================
  %% 1. CONFIGURATION (Spec Phase 1)
  %% ==========================================================================
  meta {
    title: "OmniScore V2 Demo",
    composer: "System",
    omni_version: "2.0.0",
    time: "4/4",
    tempo: 100,
    key: "C"
  }

  %% ==========================================================================
  %% 2. DEFINITIONS (Spec Phase 2)
  %% ==========================================================================
  
  %% Macro for hi-hat pattern (Spec 15)
  macro HatPattern(vel) = { h:8.vol($vel) h h h }

  group "Rhythm Section" symbol=bracket {
    def pno "Piano" style=standard clef=treble patch=gm_piano
    def bass "Bass" style=standard clef=bass patch=gm_bass transpose=-12
    def drm "Kit"   style=grid     map=gm_kit
  }

  %% ==========================================================================
  %% 3. LOGIC (Spec Phase 3)
  %% ==========================================================================

  measure 1 {
    %% Polyphony (Spec 10)
    pno: {
      v1: c5:4.stacc e5 g5:8 f5:8 |
      v2: c4:2     g3:2       |
    }
    
    %% Sticky State (Spec 5.2)
    bass: c3:8.acc c c c g2 g g g |
    
    %% Macro Expansion
    drm: k:4 $HatPattern(80) k $HatPattern(90) |
  }

  measure 2 {
    pno: {
      v1: a4:4.ten c5 d5:8 e5:8 |
      v2: f3:2     g3:2     |
    }
    
    bass: f2:8 f f f g2 g g g |
    
    drm: k:4 $HatPattern(85) k s:16 s s s |
  }
}`;
