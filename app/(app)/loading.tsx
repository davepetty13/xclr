// Route-level skeleton for the app tabs: one band block + two glass blocks.
export default function AppLoading() {
  return (
    <main aria-busy="true" className="flex flex-col gap-3 px-4 pb-6 pt-5">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div aria-hidden="true" className="h-5 w-40 rounded-control bg-segment" />
      <div aria-hidden="true" className="band h-[148px] animate-pulse" />
      <div aria-hidden="true" className="glass h-24 animate-pulse" />
      <div aria-hidden="true" className="glass h-40 animate-pulse" />
    </main>
  );
}
