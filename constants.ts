export const DEFAULT_TEMPO = 120;
export const TICKS_PER_QUARTER = 1920; 

export const GM_DRUM_MAP: Record<string, number> = {
  'k': 36, 's': 38, 'ss': 37, 'h': 42, 'ho': 46, 
  'ph': 44, 'c': 49, 'r': 51, 'rb': 53, 't1': 50, 't2': 47, 't3': 43
};

export const GUITAR_STD_TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

export const SAMPLE_CODE = `tenuto {
  meta { title: "Row Row Row your boat", tenuto_version: "2.0" }

  group "Piano" symbol=brace {
    def p1_rh "Right Hand" style=standard clef=treble
    def p1_lh "Left Hand"  style=standard clef=bass
  }

  measure 1 {
    meta { time: 6/8, key: "C" }
    p1_lh: c:4. g2 |
    p1_rh: c:4. c |
  }
  measure 2 {
    p1_lh: c3 g2 |
    p1_rh: c:6. d:12. e:4. |
  }
  measure 3 {
    p1_lh: c3 g2 |
    p1_rh: e:6. d:12. e:6. f:12. |
  }
  measure 4 {
    p1_lh: c3 g2 |
    p1_rh: g:2. |
  }
  measure 5 {
    p1_lh: c3 g2 |
    p1_rh: c5:12. c c g4 g g |
  }
  measure 6 {
    p1_lh: c3 g2 |
    p1_rh: e e e c c c |
  }
  measure 7 {
    p1_lh: g3 g2 |
    p1_rh: g:6. f:12. e:6. d:12. |
  }
  measure 8 {
    p1_lh: c3 c2 |
    p1_rh: c:2. |
  }
}`;
