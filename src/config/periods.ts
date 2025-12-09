/**
 * Period configuration for digest browsing and search
 * Defines time windows, diversity caps, and recency half-lives per period
 */

export type Period = 'day' | 'week' | 'month' | 'all';

export interface PeriodConfig {
  label: string;
  days: number;
  halfLifeDays: number; // How many days for recency score to decay to 0.5
  maxPerSource: number; // Max items per source in this period
}

export const PERIOD_CONFIG: Record<Period, PeriodConfig> = {
  day: {
    label: 'Daily',
    days: 1,
    halfLifeDays: 0.5, // 12 hours
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
    days: 90,
    halfLifeDays: 30,
    maxPerSource: 4,
  },
};

/**
 * Get period configuration by name
 */
export function getPeriodConfig(period: Period): PeriodConfig {
  return PERIOD_CONFIG[period];
}

/**
 * Validate if a period string is valid
 */
export function isValidPeriod(period: unknown): period is Period {
  return period === 'day' || period === 'week' || period === 'month' || period === 'all';
}
