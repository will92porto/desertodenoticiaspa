import { revalidatePath } from "next/cache";
import { supabaseAdmin, invokeFunction } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function runOrchestrator() {
  "use server";
  await invokeFunction("pipeline-orchestrator", {});
  revalidatePath("/pipeline");
}

async function runIngest() {
  "use server";
  await invokeFunction("ingest-cron", {});
  revalidatePath("/pipeline");
}

async function publish(formData: FormData) {
  "use server";
  await invokeFunction("publish-wordpress", {
    content_item_id: String(formData.get("id")),
    status: "draft",
  });
  revalidatePath("/pipeline");
}

const STATUS_LABEL: Record<string, string> = {
  captured: "captado", understanding: "entendendo", understood: "entendido",
  ranking: "rankeando", ranked: "rankeado", discarded: "descartado",
  writing: "escrevendo", written: "escrito", polishing: "polindo",
  polished: "polido", ready: "pronto", publishing: "publicando",
  published: "publicado", error: "erro",
};

export default async function PipelinePage() {
  const db = supabaseAdmin();
  const { data: items } = await db
    .from("content_items")
    .select("id, title, status, rank_score, region_id, regions(name)")
    .order("updated_at", { ascending: false })
    .limit(50);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Pipeline</h2>
        <div className="row">
          <form action={runIngest}><button className="btn secondary">Captar fontes agora</button></form>
          <form action={runOrchestrator}><button className="btn">Avançar pipeline</button></form>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Título</th><th>Região</th><th>Status</th><th>Nota</th><th></th></tr>
          </thead>
          <tbody>
            {(items ?? []).map((it: any) => (
              <tr key={it.id}>
                <td><a href={`/pipeline/${it.id}`}>{it.title || "(sem título)"}</a></td>
                <td className="muted">{it.regions?.name ?? "—"}</td>
                <td><span className="badge">{STATUS_LABEL[it.status] ?? it.status}</span></td>
                <td>{it.rank_score ?? "—"}</td>
                <td>
                  {it.status === "ready" && (
                    <form action={publish}>
                      <input type="hidden" name="id" value={it.id} />
                      <button className="btn secondary">Publicar</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {(!items || items.length === 0) && (
              <tr><td colSpan={5} className="muted">Nenhum item no pipeline ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
