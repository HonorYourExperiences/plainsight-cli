import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser, providers } from "@/lib/auth.mjs";
import Header from "@/components/Header";
import SignIn from "@/components/SignIn";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }) {
  if (await currentUser(await headers())) redirect("/dashboard");
  const sp = await searchParams;
  return (
    <>
      <Header />
      <main className="wrap">
        <div className="signin">
          <h1>See what you built</h1>
          <p className="lead">Sign in, pick a repo, and see its map: every page, route, table and service, and the security holes, each with the code that proves it.</p>
          <SignIn providers={providers} error={sp?.error} />
          <p className="muted small" style={{ marginTop: 24 }}>
            Rather keep your code on your machine? <code>npx plainsight-cli</code> does the same thing locally, with no account.
            When you scan here, the code is downloaded for the scan and deleted right after; only the map is kept, and you can delete it.
          </p>
        </div>
      </main>
    </>
  );
}
