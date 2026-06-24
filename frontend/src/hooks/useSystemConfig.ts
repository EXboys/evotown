import { useEffect, useState } from "react";

type SystemConfigData = Record<string, string>;

let _cached: SystemConfigData | null = null;
let _promise: Promise<SystemConfigData> | null = null;

export function useSystemConfig(): SystemConfigData {
  const [config, setConfig] = useState<SystemConfigData>(_cached || {});

  useEffect(() => {
    if (_cached) {
      setConfig(_cached);
      return;
    }
    if (!_promise) {
      _promise = fetch("/api/v1/system-config/public")
        .then((r) => r.json())
        .then((data) => {
          _cached = data as SystemConfigData;
          return _cached;
        })
        .catch(() => {
          _promise = null;
          return {} as SystemConfigData;
        });
    }
    _promise.then(setConfig);
  }, []);

  return config;
}
