import { useCallback, useEffect, useState } from "react";
import {
  DISPLAY_TIMEZONE_EVENT,
  getDisplayTimezone,
  setDisplayTimezone,
} from "../lib/datetime";

export function useDisplayTimezone() {
  const [timezone, setTz] = useState(getDisplayTimezone);

  useEffect(() => {
    const sync = () => setTz(getDisplayTimezone());
    window.addEventListener(DISPLAY_TIMEZONE_EVENT, sync);
    return () => window.removeEventListener(DISPLAY_TIMEZONE_EVENT, sync);
  }, []);

  const setTimezone = useCallback((tz: string) => {
    setDisplayTimezone(tz);
    setTz(tz);
  }, []);

  return { timezone, setTimezone };
}
