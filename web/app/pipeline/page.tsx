import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin, invokeFunction } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Executa uma chamada de função e mostra o resultado/erro na própria tela
// (via query param), em vez de falhar em silêncio.
async function runAndReport(label: string, fn: string, body: unknown) {
  let msg: string;
  try {
    const r = await invokeFunction(fn, body);
    msg = `${label}: ${JSON.stringify(r)}`;
  } catch (e) {
    msg = `${label} ERRO: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath("/pipeline");
  redirect(`/pipeline?msg=${encodeURIComponent(msg.slice(0, 500))}`);
}

async function runOrchestrator() {
  "use server";
  await runAndReport("Avançar", "pipeline-orchestrator", {});
}

async function runIngest() {
  "use server";
  await runAndReport("Captar", "ingest-cron", {});
}

async function publish(formData: FormData) {
  "use server";
  await runAndReport("Publicar", "publish-wordpress", {
    content_item_id: String(formData.get("id")),
    status: "draft",
  });
}

const STATUS_LABEL: Record<string, string> = {
  captured: "captado", understanding: "entendendo", understood: "entendido",
  ranking: "rankeando", ranked: "rankeado", discarded: "descartado",
  writing: "escrevendo", written: "escrito", polishing: "polindo",
  polished: "polido", ready: "pronto", publishing: "publicando",
  published: "publicado", error: "erro",
};

export default async function PipelinePage(
  { searchParams }: { searchParams: { msg?: string } },
) {
  const db = supabaseAdmin();
  const { data: items } = await db
    .from("content_items")
    .select("id, title, status, rank_score, region_id, regions(name)")
    .order("updated_at", { ascending: false })
    .limit(50);

  return (
    <div>
      {searchParams?.msg && (
        <div className="card" style={{ borderColor: "var(--accent)", whiteSpace: "pre-wrap", fontSize: 13 }}>
          {searchParams.msg}
        </div>
      )}
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
