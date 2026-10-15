export default function Loading() {
  return (
    <div className="animate-pulse space-y-3" aria-busy aria-label="Loading">
      <div className="h-7 w-40 rounded-md bg-stone-200" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-64 rounded-2xl border border-stone-200 bg-white" />
        <div className="hidden space-y-2 sm:block">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 rounded-xl border border-stone-200 bg-white" />
          ))}
        </div>
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="h-14 rounded-xl border border-stone-200 bg-white sm:hidden" />
      ))}
    </div>
  );
}
