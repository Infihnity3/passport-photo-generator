export interface PassportStandard {
  country: string;
  code: string;
  flag: string;
  width: number;  // mm
  height: number; // mm
  dpi: number;
  backgrounds: string[];
  notes: string;
}

export const PASSPORT_STANDARDS: PassportStandard[] = [
  {
    country: 'Malaysia',
    code: 'MY',
    flag: '🇲🇾',
    width: 35,
    height: 50,
    dpi: 300,
    backgrounds: ['#FFFFFF', '#D2E4F0'],
    notes: 'White or light blue background. Head should occupy 70-80% of frame.',
  },
  {
    country: 'United States',
    code: 'US',
    flag: '🇺🇸',
    width: 51,
    height: 51,
    dpi: 300,
    backgrounds: ['#FFFFFF'],
    notes: '2×2 inches. White background only. Head height 25-35mm.',
  },
  {
    country: 'United Kingdom',
    code: 'GB',
    flag: '🇬🇧',
    width: 35,
    height: 45,
    dpi: 300,
    backgrounds: ['#E0E0E0', '#FFFFFF'],
    notes: 'Light gray or white background. Neutral expression required.',
  },
  {
    country: 'EU / Schengen',
    code: 'EU',
    flag: '🇪🇺',
    width: 35,
    height: 45,
    dpi: 300,
    backgrounds: ['#FFFFFF', '#E0E0E0'],
    notes: 'White or light gray background. ICAO compliant.',
  },
  {
    country: 'Singapore',
    code: 'SG',
    flag: '🇸🇬',
    width: 35,
    height: 45,
    dpi: 300,
    backgrounds: ['#FFFFFF'],
    notes: 'White background. No shadows on face or background.',
  },
  {
    country: 'Australia',
    code: 'AU',
    flag: '🇦🇺',
    width: 35,
    height: 45,
    dpi: 300,
    backgrounds: ['#FFFFFF'],
    notes: 'White background. Head and shoulders only.',
  },
  {
    country: 'Japan',
    code: 'JP',
    flag: '🇯🇵',
    width: 35,
    height: 45,
    dpi: 300,
    backgrounds: ['#FFFFFF'],
    notes: 'White background. Plain, without patterns.',
  },
  {
    country: 'China',
    code: 'CN',
    flag: '🇨🇳',
    width: 33,
    height: 48,
    dpi: 300,
    backgrounds: ['#FFFFFF'],
    notes: 'White background. Head centered, ears visible.',
  },
  {
    country: 'India',
    code: 'IN',
    flag: '🇮🇳',
    width: 35,
    height: 35,
    dpi: 300,
    backgrounds: ['#FFFFFF'],
    notes: 'White background. Square format.',
  },
  {
    country: 'Canada',
    code: 'CA',
    flag: '🇨🇦',
    width: 50,
    height: 70,
    dpi: 300,
    backgrounds: ['#FFFFFF'],
    notes: 'White or light-colored background. Face 31-36mm from chin to crown.',
  },
  {
    country: 'South Korea',
    code: 'KR',
    flag: '🇰🇷',
    width: 35,
    height: 45,
    dpi: 300,
    backgrounds: ['#FFFFFF'],
    notes: 'White background. No shadows, uniform lighting.',
  },
];

export const DEFAULT_STANDARD = PASSPORT_STANDARDS[0]; // Malaysia

export function getPixelDimensions(standard: PassportStandard): { width: number; height: number } {
  const width = Math.round((standard.width / 25.4) * standard.dpi);
  const height = Math.round((standard.height / 25.4) * standard.dpi);
  return { width, height };
}
