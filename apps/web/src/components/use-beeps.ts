"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Short sounds for a scanning screen: a high beep for "got it", a low buzz for "don't know that". A scanner usually points away from
 * the screen, so the sound is how you know. The mute choice is remembered on this device.
 */
export function useBeeps() {
  const ctx = useRef<AudioContext | null>(null);
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("scan-sound") === "off") setOn(false);
    } catch {}
  }, []);
  const toggle = () => {
    setOn((v) => {
      try {
        localStorage.setItem("scan-sound", v ? "off" : "on");
      } catch {}
      return !v;
    });
  };
  const play = (ok: boolean) => {
    if (!on) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      ctx.current ??= new Ctx();
      const c = ctx.current;
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = ok ? 880 : 220;
      o.type = ok ? "sine" : "square";
      g.gain.value = 0.08;
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + (ok ? 0.08 : 0.25));
    } catch {}
  };
  return { on, toggle, play };
}
