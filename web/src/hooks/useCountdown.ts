import { useEffect, useMemo, useState } from "react";

export type CountdownSeed = Readonly<{ startsAt: string; endsAt: string; secondsRemaining?: number }>;

function remaining(seed: CountdownSeed | null, now = Date.now()) {
  if (!seed) return 0;
  const starts = new Date(seed.startsAt).getTime();
  const ends = new Date(seed.endsAt).getTime();
  if (now < starts && seed.secondsRemaining !== undefined) return seed.secondsRemaining;
  if (now < starts) return Math.max(0, Math.ceil((starts - now) / 1000));
  return Math.max(0, Math.ceil((ends - now) / 1000));
}

export function useCountdown(seed: CountdownSeed | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => remaining(seed, now), [seed, now]);
}

export const deriveSecondsRemaining = remaining;
