"use client";
import { useEffect, useRef, useState } from "react";

const hasFiles = (e: React.DragEvent | DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** Put files into a file input as if they had been chosen, so they post with its form. False where the browser won't allow it. */
export function setInputFiles(input: HTMLInputElement | null, files: File[]): boolean {
  if (!input) return false;
  try {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    input.files = dt.files;
    return true;
  } catch {
    return false;
  }
}

/**
 * Drag and drop for a picture picker: spread `handlers` on the drop target and style it while `dragging`. Dropped files reach
 * `onFiles`. While a drop target is on the page, a file dropped just beside it no longer makes the browser leave the page to open it.
 */
export function useFileDrop(onFiles: (files: File[]) => void, { disabled = false }: { disabled?: boolean } = {}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0); // dragenter/leave fire for every child; count them so the highlight doesn't flicker
  const cb = useRef(onFiles);
  cb.current = onFiles;

  useEffect(() => {
    const block = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => { window.removeEventListener("dragover", block); window.removeEventListener("drop", block); };
  }, []);

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length) cb.current(files);
    },
  };
  return { dragging, handlers };
}
