const PATHS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V20h5v-6h4v6h5V9.5",
  building: "M4 21V5l8-2v18M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20",
  tag: "M3 12V4h8l10 10-8 8L3 12ZM7.5 8.5h.01",
  pulse: "M3 12h4l2.5-6 4 12 2.5-6H21",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  menu: "M4 6h16M4 12h16M4 18h16",
  x: "M6 6l12 12M18 6 6 18",
  out: "M9 4H5v16h4M16 8l4 4-4 4M20 12H9",
  external: "M14 4h6v6M20 4 10 14M18 14v6H4V6h6",
  download: "M12 3v12m0 0-4-4m4 4 4-4M4 21h16",
  alert: "M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  arrow: "M5 12h14m-6-6 6 6-6 6",
};

export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS | (string & {}); className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
