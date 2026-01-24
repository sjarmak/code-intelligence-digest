'use client';

import { useState, useEffect } from 'react';
import DatePicker from 'react-datepicker';

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
 * Uses react-datepicker for full styling control
 * Automatically adjusts dates to valid ranges and provides clear feedback
 */
export function DateRangePicker({
  value,
  onChange,
  disabled = false,
  className = '',
}: DateRangePickerProps) {
  const [startDate, setStartDate] = useState<Date | null>(
    value?.startDate ? new Date(value.startDate) : null
  );
  const [endDate, setEndDate] = useState<Date | null>(
    value?.endDate ? new Date(value.endDate) : null
  );
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
      setStartDate(value.startDate ? new Date(value.startDate) : null);
      setEndDate(value.endDate ? new Date(value.endDate) : null);
    } else {
      setStartDate(null);
      setEndDate(null);
    }
    setError(null);
    setInfo(null);
  }, [value]);

  const handleStartDateChange = (date: Date | null) => {
    if (!date) {
      setStartDate(null);
      onChange(null);
      return;
    }

    let adjustedDate = date;
    let infoMessage: string | null = null;

    // Auto-adjust if before earliest date
    if (earliestDate) {
      const earliest = new Date(earliestDate);
      if (date < earliest) {
        adjustedDate = earliest;
        infoMessage = `Start date adjusted to earliest available record: ${earliest.toLocaleDateString()}`;
      }
    }

    setStartDate(adjustedDate);
    if (infoMessage) {
      setInfo(infoMessage);
      setTimeout(() => setInfo(null), 5000);
    } else {
      setInfo(null);
    }

    // Validate against end date
    if (endDate && adjustedDate > endDate) {
      setError('Start date must be before end date');
      onChange(null);
    } else {
      setError(null);
      if (endDate) {
        const startStr = adjustedDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];
        onChange({ startDate: startStr, endDate: endStr });
      } else {
        onChange(null);
      }
    }
  };

  const handleEndDateChange = (date: Date | null) => {
    if (!date) {
      setEndDate(null);
      if (startDate) {
        onChange(null);
      }
      return;
    }

    let adjustedDate = date;
    let infoMessage: string | null = null;

    // Auto-adjust if after today
    if (today) {
      const todayDate = new Date(today);
      if (date > todayDate) {
        adjustedDate = todayDate;
        infoMessage = `End date adjusted to today (${todayDate.toLocaleDateString()}) - future dates are not available`;
      }
    }

    setEndDate(adjustedDate);
    if (infoMessage) {
      setInfo(infoMessage);
      setTimeout(() => setInfo(null), 5000);
    } else {
      setInfo(null);
    }

    // Validate against start date
    if (startDate && adjustedDate < startDate) {
      setError('Start date must be before end date');
      onChange(null);
    } else {
      setError(null);
      if (startDate) {
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = adjustedDate.toISOString().split('T')[0];
        onChange({ startDate: startStr, endDate: endStr });
      } else {
        onChange(null);
      }
    }
  };

  // Use fetched bounds or fallback
  const minDate = earliestDate ? new Date(earliestDate) : (() => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return twoYearsAgo;
  })();
  const maxDate = today ? new Date(today) : new Date();

  const handleSetEarliest = () => {
    if (earliestDate) {
      const newStart = new Date(earliestDate);
      setStartDate(newStart);
      if (endDate) {
        const startStr = newStart.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];
        onChange({ startDate: startStr, endDate: endStr });
      } else {
        onChange(null);
      }
      setInfo(null);
      setError(null);
    }
  };

  const handleSetLatest = () => {
    const newEnd = maxDate;
    setEndDate(newEnd);
    if (startDate) {
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = newEnd.toISOString().split('T')[0];
      onChange({ startDate: startStr, endDate: endStr });
    } else {
      onChange(null);
    }
    setInfo(null);
    setError(null);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          <div className="flex items-start justify-between mb-1 min-h-[2rem]">
            <label className="text-xs font-medium text-foreground">
              Start Date
              {earliestDate && (
                <span className="text-muted font-normal ml-1 block">
                  (earliest: {new Date(earliestDate).toLocaleDateString()})
                </span>
              )}
            </label>
            {earliestDate && (
              <button
                type="button"
                onClick={handleSetEarliest}
                disabled={disabled}
                className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ml-2"
                title="Set to earliest available date"
              >
                Earliest
              </button>
            )}
          </div>
          <DatePicker
            selected={startDate}
            onChange={handleStartDateChange}
            minDate={minDate}
            maxDate={endDate || maxDate}
            disabled={disabled}
            dateFormat="MM/dd/yyyy"
            className="w-full px-3 py-2 text-sm border border-surface-border rounded-md bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            wrapperClassName="w-full"
          />
        </div>
        <div className="flex flex-col">
          <div className="flex items-start justify-between mb-1 min-h-[2rem]">
            <label className="text-xs font-medium text-foreground">
              End Date
              <span className="text-muted font-normal ml-1 block">
                (latest: today)
              </span>
            </label>
            <button
              type="button"
              onClick={handleSetLatest}
              disabled={disabled}
              className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ml-2"
              title="Set to latest available date (today)"
            >
              Latest
            </button>
          </div>
          <DatePicker
            selected={endDate}
            onChange={handleEndDateChange}
            minDate={startDate || minDate}
            maxDate={maxDate}
            disabled={disabled}
            dateFormat="MM/dd/yyyy"
            className="w-full px-3 py-2 text-sm border border-surface-border rounded-md bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            wrapperClassName="w-full"
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
