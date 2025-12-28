/**
 * Period configuration for digest browsing and search
 * Defines time windows, diversity caps, and recency half-lives per period
 */

export type Period = 'day' | 'week' | 'month' | 'all' | 'custom';

export interface PeriodConfig {
  label: string;
  days: number | null; // null for custom range
  halfLifeDays: number; // How many days for recency score to decay to 0.5
  maxPerSource: number; // Max items per source in this period
}

export const PERIOD_CONFIG: Record<Exclude<Period, 'custom'>, PeriodConfig> = {
  day: {
    label: 'Daily',
    days: 3, // Last 72 hours - ensures we catch items even if syncs are slightly delayed
    halfLifeDays: 1.5, // 36 hours
    maxPerSource: 1, // Stricter for daily
  },
  week: {
    label: 'Weekly',
    days: 7,
    halfLifeDays: 3,
    maxPerSource: 2,
  },
  month: {
    label: 'Monthly',
    days: 30,
    halfLifeDays: 10,
    maxPerSource: 3,
  },
  all: {
    label: 'All-time',
    days: 60,  // Reduced from 90 to save memory
    halfLifeDays: 30,
    maxPerSource: 4,
  },
};

/**
 * Get period configuration by name
 * For custom periods, returns a default config
 */
export function getPeriodConfig(period: Period, customDays?: number): PeriodConfig {
  if (period === 'custom' && customDays !== undefined) {
    // Estimate half-life and max per source based on custom range
    const estimatedHalfLife = Math.max(1, Math.min(customDays / 3, 30));
    const estimatedMaxPerSource = customDays <= 7 ? 2 : customDays <= 30 ? 3 : 4;
    return {
      label: 'Custom',
      days: customDays,
      halfLifeDays: estimatedHalfLife,
      maxPerSource: estimatedMaxPerSource,
    };
  }
  return PERIOD_CONFIG[period as Exclude<Period, 'custom'>];
}

/**
 * Validate if a period string is valid
 */
export function isValidPeriod(period: unknown): period is Period {
  return period === 'day' || period === 'week' || period === 'month' || period === 'all' || period === 'custom';
}
