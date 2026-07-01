import BirthdayCalendar from "@/components/BirthdayCalendar";
import { Cake } from "lucide-react";

export default function AdminBirthdays() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Cake className="h-6 w-6" /> Birthdays
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Full-year calendar of every member's birthday.
        </p>
      </div>
      <BirthdayCalendar />
    </div>
  );
}
