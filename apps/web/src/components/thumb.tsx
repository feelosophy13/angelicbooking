/** Small square picture at the start of a list row; a soft blank when there is none, so rows stay aligned. */
export function Thumb({ src, size = "h-10 w-10" }: { src: string | null; size?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={`${size} shrink-0 rounded-md bg-stone-100 object-cover`} />
  ) : (
    <span className={`${size} shrink-0 rounded-md bg-stone-100`} aria-hidden />
  );
}
