import { WorkoutNav } from "@/components/app/workout-nav";

export default function WorkoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-6">
      <h1 className="font-serif text-2xl font-medium tracking-tight text-ink">
        Workout
      </h1>
      <div className="mt-4">
        <WorkoutNav />
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}
