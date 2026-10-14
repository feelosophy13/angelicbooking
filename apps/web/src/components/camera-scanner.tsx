"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (o?: { formats?: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

const WANTED = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

/**
 * The phone's camera as a barcode scanner. Uses the browser's own reader when it has one (Chrome on Android), otherwise a small reading
 * library loaded only now. Every code read is handed to `onScan`, as a hand scanner's would be; the same code is ignored for two seconds so
 * one barcode held in view isn't counted over and over. The camera stops when this is closed.
 */
export function CameraScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    let stopped = false;
    let stop: () => void = () => {};
    let lastCode = "";
    let lastAt = 0;
    const accept = (code: string) => {
      const now = Date.now();
      if (!code || (code === lastCode && now - lastAt < 2000)) return;
      lastCode = code;
      lastAt = now;
      try {
        navigator.vibrate?.(60);
      } catch {}
      handler.current(code);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setError(window.isSecureContext ? "This browser can't use the camera." : "The camera only works on a secure (https) page.");
      try {
        const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
        if (Native) {
          const formats = ((await Native.getSupportedFormats?.()) ?? WANTED).filter((f) => WANTED.includes(f));
          const detector = new Native({ formats: formats.length ? formats : undefined });
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
          if (stopped) return stream.getTracks().forEach((t) => t.stop());
          const el = video.current!;
          el.srcObject = stream;
          await el.play();
          setLive(true);
          let timer = 0;
          const tick = async () => {
            if (stopped) return;
            try {
              const found = await detector.detect(el);
              if (found[0]) accept(found[0].rawValue);
            } catch {}
            timer = window.setTimeout(tick, 120);
          };
          tick();
          stop = () => {
            window.clearTimeout(timer);
            stream.getTracks().forEach((t) => t.stop());
          };
        } else {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
          const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video.current!, (result) => {
            if (result) accept(result.getText());
          });
          if (stopped) controls.stop();
          else {
            setLive(true);
            stop = () => controls.stop();
          }
        }
      } catch (e) {
        const name = (e as { name?: string }).name;
        setError(name === "NotAllowedError" || name === "SecurityError" ? "Camera access was blocked. Allow the camera for this site in your browser's settings, then try again." : name === "NotFoundError" || name === "OverconstrainedError" ? "No camera found on this device." : "The camera couldn't start.");
      }
    })();

    return () => {
      stopped = true;
      stop();
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-xl border border-stone-300 bg-black">
      {error ? (
        <p role="alert" className="p-4 text-sm text-white">{error}</p>
      ) : (
        <>
          <video ref={video} playsInline muted className="aspect-[4/3] max-h-72 w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-6 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80" aria-hidden />
          <p className="absolute inset-x-0 bottom-2 text-center text-xs text-white/90">{live ? "Hold a barcode inside the box" : "Starting the camera…"}</p>
        </>
      )}
      <button type="button" onClick={onClose} aria-label="Close the camera" className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"><X className="h-4 w-4" /></button>
    </div>
  );
}
