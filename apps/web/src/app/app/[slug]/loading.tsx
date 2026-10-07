export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy aria-label="Loading">
      <div className="mb-6 flex items-center justify-between">
        <div className="h-7 w-48 rounded-md bg-stone-200" />
        <div className="h-9 w-32 rounded-lg bg-stone-200" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl border border-stone-200 bg-white p-4">
            <div className="h-3 w-1/3 rounded bg-stone-200" />
            <div className="mt-2 h-2.5 w-1/4 rounded bg-stone-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
