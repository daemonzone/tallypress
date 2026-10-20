import { notFound } from "next/navigation";
import { Dashboard } from "@/components/dashboard";

export default async function MonthPage({ params }: PageProps<"/month/[month]">) {
  const { month } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) notFound();
  return <Dashboard monthKey={`${month}-01`} />;
}
