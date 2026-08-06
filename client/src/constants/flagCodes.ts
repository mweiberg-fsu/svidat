export interface FlagCode {
  code: string
  description: string
}

// Fixed QC flag scheme — not derived from file metadata (unlike the rest of
// this app's variable/dimension data). Every file uses the same 26 codes.
export const FLAG_CODES: FlagCode[] = [
  { code: 'A', description: 'Units added' },
  { code: 'B', description: 'Out of bounds' },
  { code: 'C', description: 'Time not sequential' },
  { code: 'D', description: 'Failed T>Tw>Td' },
  { code: 'E', description: 'True wind error' },
  { code: 'F', description: 'Unreal movement' },
  { code: 'G', description: 'Value > 4 s.d.' },
  { code: 'H', description: 'Discontinuity' },
  { code: 'I', description: 'Interesting feature' },
  { code: 'J', description: 'Bad data' },
  { code: 'K', description: 'Suspect/Caution' },
  { code: 'L', description: 'Land Error' },
  { code: 'M', description: 'Malfunction' },
  { code: 'N', description: 'In port' },
  { code: 'O', description: 'Multiple convers_units' },
  { code: 'P', description: 'Plat. position uncert.' },
  { code: 'Q', description: 'Questionable' },
  { code: 'R', description: 'Interpolated value' },
  { code: 'S', description: 'Spike' },
  { code: 'T', description: 'Time duplicate' },
  { code: 'U', description: 'Suspect from flagger' },
  { code: 'V', description: 'Spike from flagger' },
  { code: 'W', description: 'Undefined' },
  { code: 'X', description: 'Step from flagger' },
  { code: 'Y', description: "Suspect between X's" },
  { code: 'Z', description: 'Good data' },
]
