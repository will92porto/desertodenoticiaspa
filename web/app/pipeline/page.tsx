import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin, invokeFunction } from "@/lib/supabase";

import { SubmitButton } from "@/components/SubmitButton";
import { AdvancePipelineButton } from "@/components/AdvancePipelineButton";
import { AutoRefresh } from "@/components/AutoRefresh";

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

async function runIngest() {
  "use server";
  await runAndReport("Captar", "ingest-cron", {});
}

async function publish(id: string) {
  "use server";
  await runAndReport("Publicar", "publish-wordpress", {
    content_item_id: id,
    status: "draft",
  });
}

async function advanceStepAction(ids?: string[]) {
  "use server";
  try {
    const res = await invokeFunction("pipeline-orchestrator", { ids: ids || [] });
    if (res.error) return { done: true, error: res.error };
    return { done: res.done === true, error: undefined };
  } catch (e: any) {
    return { done: true, error: e.message };
  }
}

async function massDelete(formData: FormData) {
  "use server";
  const ids = formData.getAll("ids");
  if (!ids || ids.length === 0) return;
  
  try {
    const db = supabaseAdmin();
    const idList = ids.map(id => String(id));
    await db.from("pipeline_runs").delete().in("content_item_id", idList);
    await db.from("content_items").delete().in("id", idList);
  } catch (err) {
    console.error("Exceção ao excluir em massa:", err);
  }
  revalidatePath("/pipeline");
  redirect("/pipeline");
}

const STATUS_LABEL: Record<string, string> = {
  captured: "captado", understanding: "entendendo", understood: "entendido",
  ranking: "rankeando", ranked: "rankeado", discarded: "descartado",
  writing: "escrevendo", written: "escrito", polishing: "polindo",
  polished: "polido", ready: "pronto", publishing: "publicando",
  published: "publicado", error: "erro",
};

export default async function PipelinePage(
  { searchParams }: { searchParams: { msg?: string; sort?: string; order?: string } },
) {
  const db = supabaseAdmin();
  
  const sortCol = searchParams?.sort || "created_at";
  const sortOrder = searchParams?.order === "asc" ? true : false;

  let query = db
    .from("content_items")
    .select("id, title, status, rank_score, created_at, region_id, regions(name), sources(name)")
    .order("created_at", { ascending: false })
    .limit(300);

  const { data: rawItems } = await query;
  let items = rawItems ?? [];

  // Ordenação feita em JS para garantir que os itens exibidos (os 300 mais recentes) 
  // sejam sempre os mesmos, independentemente da coluna clicada (evitando que sumam pelo limit do banco).
  items.sort((a: any, b: any) => {
    let valA = a[sortCol];
    let valB = b[sortCol];

    if (sortCol === "source") {
      valA = a.sources?.name || "";
      valB = b.sources?.name || "";
    } else if (sortCol === "title" || sortCol === "status") {
      valA = valA || "";
      valB = valB || "";
    } else if (sortCol === "rank_score") {
      valA = valA ?? 0;
      valB = valB ?? 0;
    } else if (sortCol === "created_at") {
      valA = new Date(valA || 0).getTime();
      valB = new Date(valB || 0).getTime();
    }

    if (typeof valA === "string" && typeof valB === "string") {
      return sortOrder ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else {
      return sortOrder ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    }
  });

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
          <form action={runIngest}>
            <AutoRefresh />
            <SubmitButton className="btn secondary">Captar fontes agora</SubmitButton>
          </form>
          <form>
            <AutoRefresh />
            <AdvancePipelineButton 
              actionFn={advanceStepAction}
              className="btn" 
              confirmMessage="Isto iniciará o processamento de todos os itens disponíveis. Deseja continuar?"
              label="Avançar pipeline"
            />
          </form>
        </div>
      </div>

      <div className="card">
        <form>
          <AutoRefresh />
          <div style={{ marginBottom: "1rem", display: "flex", gap: "10px" }}>
            <SubmitButton formAction={massDelete} className="btn" style={{ background: "var(--red)", borderColor: "var(--red)", padding: "4px 8px", fontSize: "0.85rem" }} confirmMessage="Tem certeza que deseja excluir as pautas selecionadas?">
              Excluir Selecionados
            </SubmitButton>
            <AdvancePipelineButton 
              actionFn={advanceStepAction}
              className="btn secondary" 
              style={{ padding: "4px 8px", fontSize: "0.85rem" }} 
              confirmMessage="Deseja avançar todas as pautas selecionadas?"
              label="Avançar Selecionados"
            />
          </div>
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
              <th><a href="?sort=title&order=asc" className="muted">Título</a></th>
              <th><a href="?sort=source&order=asc" className="muted">Fonte</a></th>
              <th><a href="?sort=created_at&order=desc" className="muted">Criado em</a></th>
              <th>Região</th>
              <th><a href="?sort=status&order=asc" className="muted">Status</a></th>
              <th><a href="?sort=rank_score&order=desc" className="muted">Nota</a></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((it: any) => (
              <tr key={it.id} style={{ opacity: it.status === "discarded" ? 0.6 : 1 }}>
                <td>
                  <input type="checkbox" name="ids" value={it.id} />
                </td>
                <td><a href={`/pipeline/${it.id}`}>{it.title || "(sem título)"}</a></td>
                <td className="muted">{it.sources?.name ?? "—"}</td>
                <td className="muted" style={{ fontSize: "0.85rem" }}>
                  {it.created_at ? new Date(it.created_at).toLocaleString("pt-BR") : "—"}
                </td>
                <td className="muted">{it.regions?.name ?? "—"}</td>
                <td>
                  <span className="badge" style={{
                    background: it.status === "discarded" || it.status === "error" ? "rgba(224, 87, 75, 0.15)" : 
                                it.status === "ready" || it.status === "published" ? "rgba(76, 175, 80, 0.15)" : 
                                it.status === "publishing" || it.status === "understanding" || it.status === "ranking" || it.status === "writing" || it.status === "polishing" ? "rgba(224, 164, 88, 0.15)" : undefined,
                    color: it.status === "discarded" || it.status === "error" ? "var(--red)" : 
                           it.status === "ready" || it.status === "published" ? "var(--green)" : 
                           it.status === "publishing" || it.status === "understanding" || it.status === "ranking" || it.status === "writing" || it.status === "polishing" ? "var(--accent)" : undefined,
                    borderColor: it.status === "discarded" || it.status === "error" ? "rgba(224, 87, 75, 0.3)" : 
                                 it.status === "ready" || it.status === "published" ? "rgba(76, 175, 80, 0.3)" : 
                                 it.status === "publishing" || it.status === "understanding" || it.status === "ranking" || it.status === "writing" || it.status === "polishing" ? "rgba(224, 164, 88, 0.3)" : undefined
                  }}>
                    {STATUS_LABEL[it.status] ?? it.status}
                  </span>
                </td>
                <td>{it.rank_score ?? "—"}</td>
                <td>
                  {it.status === "ready" && (
                    <SubmitButton formAction={publish.bind(null, it.id)} className="btn secondary" confirmMessage="Publicar no WordPress?">Publicar</SubmitButton>
                  )}
                </td>
              </tr>
            ))}
            {(!items || items.length === 0) && (
              <tr><td colSpan={8} className="muted">Nenhum item no pipeline ainda.</td></tr>
            )}
          </tbody>
        </table>
        </form>
      </div>
    </div>
  );
}
