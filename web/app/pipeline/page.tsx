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
  { searchParams }: { searchParams: { msg?: string; sort?: string; order?: string } },
) {
  const db = supabaseAdmin();
  
  const sortCol = searchParams?.sort || "created_at";
  const sortOrder = searchParams?.order === "asc" ? true : false;

  let query = db
    .from("content_items")
    .select("id, title, status, rank_score, created_at, region_id, regions(name), sources(name)")
    .limit(100);

  // Tratamento especial para ordenar por fonte (que é uma tabela relacionada)
  // Como o Supabase não suporta order by em foreign tables nativamente com JS simples sem view,
  // se for 'source', ordenamos em JS ou criamos um workaround. Para manter simples, 
  // permitimos ordenação nativa nas colunas locais.
  if (sortCol === "source") {
    // Se quiser ordenar por fonte, pegamos tudo (limite 100) e ordenamos no JS abaixo.
    query = query.order("created_at", { ascending: false });
  } else {
    query = query.order(sortCol, { ascending: sortOrder });
  }

  const { data: rawItems } = await query;
  let items = rawItems ?? [];

  if (sortCol === "source") {
    items.sort((a, b) => {
      const s1 = a.sources?.name || "";
      const s2 = b.sources?.name || "";
      return sortOrder ? s1.localeCompare(s2) : s2.localeCompare(s1);
    });
  }

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
            <tr>
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
              <tr key={it.id}>
                <td><a href={`/pipeline/${it.id}`}>{it.title || "(sem título)"}</a></td>
                <td className="muted">{it.sources?.name ?? "—"}</td>
                <td className="muted" style={{ fontSize: "0.85rem" }}>
                  {it.created_at ? new Date(it.created_at).toLocaleString("pt-BR") : "—"}
                </td>
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
              <tr><td colSpan={7} className="muted">Nenhum item no pipeline ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
