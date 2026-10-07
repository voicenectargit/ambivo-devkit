// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import {
  argbFromHex,
  hexFromArgb,
  Scheme,
  Theme,
  themeFromSourceColor,
  TonalPalette,
} from '@material/material-color-utilities';

interface ThemeConfig {
  sourceColor: string;
  /** Amount of primary hue to blend into neutral surfaces (0-100, default 16) */
  surfaceTint?: number;
  targetElement?: HTMLElement;
}

/**
 * Generates and applies Material Design 3 theme using light-dark() CSS function
 */
export function applyMaterialTheme(config: ThemeConfig): void {
  const { sourceColor, surfaceTint = 50, targetElement = document.documentElement } = config;

  // Generate theme with all palettes
  const theme = themeFromSourceColor(argbFromHex(sourceColor));

  // Apply combined light-dark theme
  applyCombinedTheme(theme, targetElement, surfaceTint);
}

/**
 * Maps Material Color Utilities scheme to Angular Material CSS variables
 * Includes surface tones derived from neutral palette with configurable tint
 */
function getThemeVariables(
  scheme: Scheme,
  theme: Theme,
  isDark: boolean,
  surfaceTint: number,
): Record<string, string> {
  // Clamp surfaceTint to 0-100 range
  const clampedTint = Math.max(0, Math.min(100, surfaceTint));
  // Map 0-100 to chroma 0-16 (subtle tint, dark mode tolerates less chroma)
  // Dark mode uses lower max chroma to prevent over-saturation at low tones
  const maxChroma = isDark ? 12 : 16;
  const neutralChroma = (clampedTint / 100) * maxChroma;
  const neutral = TonalPalette.fromHueAndChroma(theme.palettes.primary.hue, neutralChroma);

  // Tone shift factor: 0 at surfaceTint=0, 1 at surfaceTint=100
  const toneShift = clampedTint / 100;

  // Helper to interpolate tones based on tint level
  // At tint=0: uses baseTone, at tint=100: uses tintedTone
  const adjustTone = (baseTone: number, tintedTone: number): number =>
    baseTone + (tintedTone - baseTone) * toneShift;

  // Surface tone mapping with dynamic adjustment based on surfaceTint
  const surfaceTones = isDark
    ? {
        dim: neutral.tone(adjustTone(0, 6)),
        default: neutral.tone(adjustTone(0, 6)),
        bright: neutral.tone(adjustTone(20, 24)),
        containerLowest: neutral.tone(adjustTone(0, 4)),
        containerLow: neutral.tone(adjustTone(4, 10)),
        container: neutral.tone(adjustTone(6, 12)),
        containerHigh: neutral.tone(adjustTone(10, 17)),
        containerHighest: neutral.tone(adjustTone(14, 22)),
      }
    : {
        dim: neutral.tone(adjustTone(90, 87)),
        default: neutral.tone(adjustTone(100, 98)),
        bright: neutral.tone(adjustTone(100, 98)),
        containerLowest: neutral.tone(adjustTone(100, 100)),
        containerLow: neutral.tone(adjustTone(100, 96)),
        container: neutral.tone(adjustTone(98, 94)),
        containerHigh: neutral.tone(adjustTone(96, 92)),
        containerHighest: neutral.tone(adjustTone(94, 90)),
      };

  return {
    // Primary colors
    primary: hexFromArgb(scheme.primary),
    'on-primary': hexFromArgb(scheme.onPrimary),
    'primary-container': hexFromArgb(scheme.primaryContainer),
    'on-primary-container': hexFromArgb(scheme.onPrimaryContainer),

    // Secondary colors
    secondary: hexFromArgb(scheme.secondary),
    'on-secondary': hexFromArgb(scheme.onSecondary),
    'secondary-container': hexFromArgb(scheme.secondaryContainer),
    'on-secondary-container': hexFromArgb(scheme.onSecondaryContainer),

    // Tertiary colors
    tertiary: hexFromArgb(scheme.tertiary),
    'on-tertiary': hexFromArgb(scheme.onTertiary),
    'tertiary-container': hexFromArgb(scheme.tertiaryContainer),
    'on-tertiary-container': hexFromArgb(scheme.onTertiaryContainer),

    // Error colors
    error: hexFromArgb(scheme.error),
    'on-error': hexFromArgb(scheme.onError),
    'error-container': hexFromArgb(scheme.errorContainer),
    'on-error-container': hexFromArgb(scheme.onErrorContainer),

    // Background colors
    background: hexFromArgb(scheme.background),
    'on-background': hexFromArgb(scheme.onBackground),

    // Surface colors - base
    surface: hexFromArgb(surfaceTones.default),
    'on-surface': hexFromArgb(scheme.onSurface),
    'surface-variant': hexFromArgb(scheme.surfaceVariant),
    'on-surface-variant': hexFromArgb(scheme.onSurfaceVariant),

    // Surface colors - tonal variations
    'surface-dim': hexFromArgb(surfaceTones.dim),
    'surface-bright': hexFromArgb(surfaceTones.bright),
    'surface-container-lowest': hexFromArgb(surfaceTones.containerLowest),
    'surface-container-low': hexFromArgb(surfaceTones.containerLow),
    'surface-container': hexFromArgb(surfaceTones.container),
    'surface-container-high': hexFromArgb(surfaceTones.containerHigh),
    'surface-container-highest': hexFromArgb(surfaceTones.containerHighest),

    // Surface tint
    'surface-tint': hexFromArgb(scheme.primary),

    // Inverse colors
    'inverse-surface': hexFromArgb(scheme.inverseSurface),
    'inverse-on-surface': hexFromArgb(scheme.inverseOnSurface),
    'inverse-primary': hexFromArgb(scheme.inversePrimary),

    // Outline colors
    outline: hexFromArgb(scheme.outlineVariant),
    'outline-variant': hexFromArgb(scheme.outlineVariant),

    // Other colors
    shadow: hexFromArgb(scheme.shadow),
    scrim: hexFromArgb(scheme.scrim),
  };
}

/**
 * Gets fixed color values (same in both light and dark modes)
 */
function getFixedColors(theme: Theme): Record<string, string> {
  const primary = theme.palettes.primary;
  const secondary = theme.palettes.secondary;
  const tertiary = theme.palettes.tertiary;

  return {
    // Primary fixed colors
    'primary-fixed': hexFromArgb(primary.tone(90)),
    'primary-fixed-dim': hexFromArgb(primary.tone(80)),
    'on-primary-fixed': hexFromArgb(primary.tone(10)),
    'on-primary-fixed-variant': hexFromArgb(primary.tone(30)),

    // Secondary fixed colors
    'secondary-fixed': hexFromArgb(secondary.tone(90)),
    'secondary-fixed-dim': hexFromArgb(secondary.tone(80)),
    'on-secondary-fixed': hexFromArgb(secondary.tone(10)),
    'on-secondary-fixed-variant': hexFromArgb(secondary.tone(30)),

    // Tertiary fixed colors
    'tertiary-fixed': hexFromArgb(tertiary.tone(90)),
    'tertiary-fixed-dim': hexFromArgb(tertiary.tone(80)),
    'on-tertiary-fixed': hexFromArgb(tertiary.tone(10)),
    'on-tertiary-fixed-variant': hexFromArgb(tertiary.tone(30)),
  };
}

/** Cached result of light-dark() support check */
let _supportsLightDark: boolean | undefined;

function supportsLightDark(): boolean {
  if (_supportsLightDark === undefined) {
    _supportsLightDark = CSS.supports('color', 'light-dark(#000, #fff)');
  }
  return _supportsLightDark;
}

/**
 * Applies combined theme variables.
 * Uses light-dark() CSS function when supported, falls back to plain values based on current color-scheme.
 */
function applyCombinedTheme(theme: Theme, element: HTMLElement, surfaceTint: number): void {
  const lightVars = getThemeVariables(theme.schemes.light, theme, false, surfaceTint);
  const darkVars = getThemeVariables(theme.schemes.dark, theme, true, surfaceTint);
  const fixedVars = getFixedColors(theme);

  // Create or update style element for theme
  let styleElement = document.getElementById('material-theme-vars') as HTMLStyleElement;

  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = 'material-theme-vars';
    document.head.appendChild(styleElement);
  }

  const selector = element === document.documentElement ? ':root' : '.themed-element';
  const useLightDark = supportsLightDark();

  if (useLightDark) {
    // Modern browsers: use light-dark() for automatic mode switching
    const combinedVars: string[] = [];

    Object.keys(lightVars).forEach((key) => {
      combinedVars.push(`--mat-sys-${key}: light-dark(${lightVars[key]}, ${darkVars[key]});`);
    });

    Object.entries(fixedVars).forEach(([key, value]) => {
      combinedVars.push(`--mat-sys-${key}: light-dark(${value}, ${value});`);
    });

    styleElement.textContent = `
      ${selector} {
        ${combinedVars.join('\n        ')}
      }
    `;
  } else {
    // Fallback: use class-based selectors so dark/light toggle works without light-dark()
    const buildVars = (vars: Record<string, string>): string[] =>
      Object.entries(vars).map(([key, value]) => `--mat-sys-${key}: ${value};`);

    const fixedLines = buildVars(fixedVars);
    const lightLines = [...buildVars(lightVars), ...fixedLines];
    const darkLines = [...buildVars(darkVars), ...fixedLines];

    styleElement.textContent = `
      ${selector} {
        ${lightLines.join('\n        ')}
      }
      html.dark-theme {
        ${darkLines.join('\n        ')}
      }
    `;
  }
}

/**
 * Manually set theme mode
 */
export function setThemeMode(mode: 'light' | 'dark' | 'auto'): void {
  const root = document.documentElement;

  if (mode === 'auto') {
    root.style.colorScheme = 'light dark';
  } else {
    root.style.colorScheme = mode;
  }
}

/**
 * Get current effective theme mode
 */
export function getCurrentThemeMode(): 'light' | 'dark' {
  const colorScheme = document.documentElement.style.colorScheme;

  // If explicitly set to light or dark
  if (colorScheme === 'light') return 'light';
  if (colorScheme === 'dark') return 'dark';

  // Fall back to system preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Toggle between light and dark theme
 */
export function toggleTheme(): void {
  const currentMode = getCurrentThemeMode();
  setThemeMode(currentMode === 'light' ? 'dark' : 'light');
}

/**
 * Listen to system theme changes
 */
export function observeSystemTheme(callback: (isDark: boolean) => void): () => void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const handler = (e: MediaQueryListEvent) => {
    callback(e.matches);
  };

  mediaQuery.addEventListener('change', handler);

  // Call immediately with current value
  callback(mediaQuery.matches);

  // Return cleanup function
  return () => mediaQuery.removeEventListener('change', handler);
}

/**
 * Export the current theme as JSON for debugging
 */
export function exportTheme(
  sourceColor: string,
  surfaceTint = 50,
): {
  light: Record<string, string>;
  dark: Record<string, string>;
  fixed: Record<string, string>;
} {
  const theme = themeFromSourceColor(argbFromHex(sourceColor));

  return {
    light: getThemeVariables(theme.schemes.light, theme, false, surfaceTint),
    dark: getThemeVariables(theme.schemes.dark, theme, true, surfaceTint),
    fixed: getFixedColors(theme),
  };
}

/**
 * Apply custom theme with multiple source colors
 */
export function applyCustomTheme(config: {
  primary: string;
  secondary?: string;
  tertiary?: string;
  error?: string;
  neutral?: string;
  neutralVariant?: string;
  surfaceTint?: number;
}): void {
  const { primary, secondary, tertiary, error, neutral, neutralVariant, surfaceTint = 50 } = config;

  const customColors = [];

  if (secondary) {
    customColors.push({
      name: 'secondary',
      value: argbFromHex(secondary),
      blend: true,
    });
  }

  if (tertiary) {
    customColors.push({
      name: 'tertiary',
      value: argbFromHex(tertiary),
      blend: true,
    });
  }

  if (error) {
    customColors.push({
      name: 'error',
      value: argbFromHex(error),
      blend: false,
    });
  }

  if (neutral) {
    customColors.push({
      name: 'neutral',
      value: argbFromHex(neutral),
      blend: false,
    });
  }

  if (neutralVariant) {
    customColors.push({
      name: 'neutral-variant',
      value: argbFromHex(neutralVariant),
      blend: false,
    });
  }

  const theme = themeFromSourceColor(
    argbFromHex(primary),
    customColors.length > 0 ? customColors : undefined,
  );

  applyCombinedTheme(theme, document.documentElement, surfaceTint);
}
