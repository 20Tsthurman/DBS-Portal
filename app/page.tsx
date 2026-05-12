import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";

export default async function RootPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const user = await currentUser();
  const role = user?.publicMetadata?.role as string | undefined;

  if (role === "owner") {
    redirect("/owner/dashboard");
  }

  if (role === "client") {
    redirect("/client/dashboard");
  }

  redirect("/sign-in");
}
