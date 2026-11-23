import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/lib/auth.mjs";
import { getMap } from "@/lib/store.mjs";
import Header from "@/components/Header";
import { Counts } from "@/components/MapList";
import MapFrame from "@/components/MapFrame";

export const dynamic = "force-dynamic";

export default async function MapPage({ params }) {
  const user = await currentUser(await headers());
  if (!user) redirect("/");
  const { id } = await params;
  const map = await getMap(user.id, id);
  if (!map) notFound();
  return (
    <>
      <Header user={user} current="dashboard" />
      <main className="wrap" style={{ maxWidth: "none", paddingTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div className="row">
            <h1 style={{ margin: 0, fontSize: 22 }}>{map.repo}{map.commit && <span className="muted mono" style={{ fontSize: 14 }}> @ {map.commit}</span>}</h1>
            <Counts counts={map.counts} />
          </div>
          <div className="row">
            <a className="btn" href={`/api/v1/maps/${map.id}?graph=1`} download={`${map.repo.replace("/", "-")}.plainsight.json`}>Download JSON</a>
            <a className="btn" href={`/maps/${map.id}/report`} target="_blank" rel="noopener">Open full screen</a>
          </div>
        </div>
        <MapFrame title={`Plainsight map of ${map.repo}`} src={`/maps/${map.id}/report`} />
      </main>
    </>
  );
}
