export default function Loading() {
  return (
    <div className="animate-pulse space-y-3" aria-busy aria-label="Loading">
      <div className="h-7 w-40 rounded-md bg-stone-200" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 rounded-xl border border-stone-200 bg-white" />
      ))}
    </div>
  );
}
