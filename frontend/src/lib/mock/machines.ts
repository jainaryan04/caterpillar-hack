/** Engine temperature thresholds in °C — spec §5.4. Not per-machine data, so
 * this stays even though the machine roster itself now comes from the API. */
export const ENGINE_TEMP = { elevated: 95, critical: 105 };
