// Theme configuration derived from project plan color palette

import {
  createLightTheme,
  createDarkTheme,
  type BrandVariants,
} from '@fluentui/react-components';

// Brand ramp derived from primary color #2F6FEB
const brandRamp: BrandVariants = {
  10: '#030712',
  20: '#0A1633',
  30: '#142554',
  40: '#1F3575',
  50: '#2A4596',
  60: '#2F6FEB', // Primary from plan
  70: '#5289EE',
  80: '#75A3F1',
  90: '#98BDF4',
  100: '#BBD7F7',
  110: '#DEF1FA',
  120: '#E8F5FC',
  130: '#F1F9FD',
  140: '#F9FCFE',
  150: '#FCFDFF',
  160: '#FFFFFF',
};

export const lightTheme = createLightTheme(brandRamp);
export const darkTheme = createDarkTheme(brandRamp);

// CSS custom properties for plan-specific tokens
export const customTokens = `
  :root {
    --color-primary: #2F6FEB;
    --color-accent: #7A5AF8;
    --color-surface: #F7F8FA;
    --color-text: #1B1E23;
    --color-muted: #6B7280;
    --color-border: #E1E4E8;
    
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  
  body {
    margin: 0;
    background-color: var(--color-surface);
    color: var(--color-text);
  }
  
  * {
    box-sizing: border-box;
  }
`;
