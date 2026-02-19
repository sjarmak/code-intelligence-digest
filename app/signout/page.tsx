import { signOut } from "@/src/auth";

interface SignOutPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SignOutPage({ searchParams }: SignOutPageProps) {
  const { callbackUrl } = await searchParams;
  const redirectTo =
    !callbackUrl
      ? "/login"
      : callbackUrl.startsWith("http")
        ? new URL(callbackUrl).pathname
        : callbackUrl;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-6">
        <h2 className="text-xl font-semibold text-gray-900">
          Are you sure you want to sign out?
        </h2>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo });
          }}
        >
          <button
            type="submit"
            className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
