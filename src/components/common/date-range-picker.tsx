'use client';

import { useState, useEffect } from 'react';

export interface DateRange {
  startDate: string; // ISO date string (YYYY-MM-DD)
  endDate: string; // ISO date string (YYYY-MM-DD)
}

interface DateRangePickerProps {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Reusable date range picker component
 * Uses native HTML5 date inputs for best UX and accessibility
 * Automatically adjusts dates to valid ranges and provides clear feedback
 */
export function DateRangePicker({
  value,
  onChange,
  disabled = false,
  className = '',
}: DateRangePickerProps) {
  const [startDate, setStartDate] = useState(value?.startDate || '');
  const [endDate, setEndDate] = useState(value?.endDate || '');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [earliestDate, setEarliestDate] = useState<string | null>(null);
  const [today, setToday] = useState<string>('');

  // Fetch date bounds on mount
  useEffect(() => {
    const fetchDateBounds = async () => {
      try {
        const response = await fetch('/api/config/date-bounds');
        if (response.ok) {
          const data = await response.json();
          setEarliestDate(data.earliestDate);
          setToday(data.latestDate);
        } else {
          // Fallback to reasonable defaults
          const todayDate = new Date().toISOString().split('T')[0];
          const twoYearsAgo = new Date();
          twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
          setToday(todayDate);
          setEarliestDate(twoYearsAgo.toISOString().split('T')[0]);
        }
      } catch (err) {
        // Fallback to reasonable defaults
        const todayDate = new Date().toISOString().split('T')[0];
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        setToday(todayDate);
        setEarliestDate(twoYearsAgo.toISOString().split('T')[0]);
      }
    };
    fetchDateBounds();
  }, []);

  // Sync with external value changes
  useEffect(() => {
    if (value) {
      setStartDate(value.startDate);
      setEndDate(value.endDate);
    } else {
      setStartDate('');
      setEndDate('');
    }
    setError(null);
    setInfo(null);
  }, [value]);

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newStart = e.target.value;
    let adjustedStart = newStart;
    let infoMessage: string | null = null;

    // Auto-adjust if before earliest date
    if (earliestDate && newStart && newStart < earliestDate) {
      adjustedStart = earliestDate;
      infoMessage = `Start date adjusted to earliest available record: ${new Date(earliestDate).toLocaleDateString()}`;
    }

    setStartDate(adjustedStart);
    if (infoMessage) {
      setInfo(infoMessage);
      // Clear info message after 5 seconds
      setTimeout(() => setInfo(null), 5000);
    } else {
      setInfo(null);
    }

    // Validate against end date
    if (adjustedStart && endDate && adjustedStart > endDate) {
      setError('Start date must be before end date');
      onChange(null);
    } else {
      setError(null);
      if (adjustedStart && endDate) {
        onChange({ startDate: adjustedStart, endDate });
      } else {
        onChange(null);
      }
    }
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEnd = e.target.value;
    let adjustedEnd = newEnd;
    let infoMessage: string | null = null;

    // Auto-adjust if after today
    if (today && newEnd && newEnd > today) {
      adjustedEnd = today;
      infoMessage = `End date adjusted to today (${new Date(today).toLocaleDateString()}) - future dates are not available`;
    }

    setEndDate(adjustedEnd);
    if (infoMessage) {
      setInfo(infoMessage);
      // Clear info message after 5 seconds
      setTimeout(() => setInfo(null), 5000);
    } else {
      setInfo(null);
    }

    // Validate against start date
    if (startDate && adjustedEnd && startDate > adjustedEnd) {
      setError('Start date must be before end date');
      onChange(null);
    } else {
      setError(null);
      if (startDate && adjustedEnd) {
        onChange({ startDate, endDate: adjustedEnd });
      } else {
        onChange(null);
      }
    }
  };

  // Use fetched bounds or fallback
  const minDate = earliestDate || (() => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return twoYearsAgo.toISOString().split('T')[0];
  })();
  const maxDate = today || new Date().toISOString().split('T')[0];

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="start-date" className="block text-xs font-medium text-foreground mb-1">
            Start Date
            {earliestDate && (
              <span className="text-muted font-normal ml-1">
                (earliest: {new Date(earliestDate).toLocaleDateString()})
              </span>
            )}
          </label>
          <input
            id="start-date"
            type="date"
            value={startDate}
            onChange={handleStartDateChange}
            min={minDate}
            max={endDate || maxDate}
            disabled={disabled}
            className="w-full px-3 py-2 text-sm border border-surface-border rounded-md bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
        <div>
          <label htmlFor="end-date" className="block text-xs font-medium text-foreground mb-1">
            End Date
            <span className="text-muted font-normal ml-1">
              (latest: today)
            </span>
          </label>
          <input
            id="end-date"
            type="date"
            value={endDate}
            onChange={handleEndDateChange}
            min={startDate || minDate}
            max={maxDate}
            disabled={disabled}
            className="w-full px-3 py-2 text-sm border border-surface-border rounded-md bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {info && (
        <div className="text-xs text-foreground bg-gray-50 border border-gray-300 rounded px-2 py-1.5" role="status">
          {info}
        </div>
      )}
      {value && !error && (
        <p className="text-xs text-muted">
          Range: {new Date(value.startDate).toLocaleDateString()} - {new Date(value.endDate).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

