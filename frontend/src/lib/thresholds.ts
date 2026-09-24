/**
 * Fixed operational thresholds. These are spec/policy constants, not data —
 * nothing in the backend stores them, and they do not vary per machine or
 * per operator.
 */

/** Engine temperature bands in °C — spec §5.4. */
export const ENGINE_TEMP = { elevated: 95, critical: 105 };

/** Fatigue bands on the backend's 0–100 `current_fatigue` scale — spec §5.3.1. */
export const FATIGUE = { elevated: 40, high: 70 };
