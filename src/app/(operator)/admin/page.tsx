import { redirect } from "next/navigation";

/** Admin opens on System status. */
export default function AdminPage() {
  redirect("/admin/system");
}
