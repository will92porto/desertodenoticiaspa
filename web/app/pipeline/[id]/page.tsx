import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin, invokeFunction } from "@/lib/supabase";

import { SubmitButton } from "@/components/SubmitButton";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

const STEP_FN: Record<string, string> = {
  understand: "step-understand",
  rank: "step-rank",
  write: "step-write",
  polish: "step-polish",
};

async function runOneStep(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const step = String(formData.get("step"));
  const fn = STEP_FN[step];
  let msg: string;
  try {
    const r = await invokeFunction(fn, { content_item_id: id });
    msg = `${step}: ${JSON.stringify(r)}`;
  } catch (e) {
    msg = `${step} ERRO: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath(`/pipeline/${id}`);
  redirect(`/pipeline/${id}?msg=${encodeURIComponent(msg.slice(0, 500))}`);
}

async function runAllSteps(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  let msg = "Processamento em lote finalizado com sucesso!";
  try {
    const r1 = await invokeFunction("step-understand", { content_item_id: id });
    if (r1.error) throw new Error(r1.error);

    const r2 = await invokeFunction("step-rank", { content_item_id: id });
    if (r2.error) throw new Error(r2.error);

    if (r2.status === "discarded") {
      msg = "Processo abortado: A matéria foi DESCARTADA pelo robô de Ranking por ter relevância baixa.";
    } else {
      const r3 = await invokeFunction("step-write", { content_item_id: id });
      if (r3.error) throw new Error(r3.error);

      const r4 = await invokeFunction("step-polish", { content_item_id: id });
      if (r4.error) throw new Error(r4.error);
    }
  } catch (e) {
    msg = `ERRO na execução em lote: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath(`/pipeline/${id}`);
  redirect(`/pipeline/${id}?msg=${encodeURIComponent(msg.slice(0, 500))}`);
}

export default async function ItemDetail(
  { params, searchParams }: { params: { id: string }; searchParams: { msg?: string } },
) {
  const db = supabaseAdmin();
  const { data: item } = await db.from("content_items").select("*").eq("id", params.id).single();
  const { data: runs } = await db
    .from("pipeline_runs").select("step, model, status, duration_ms, created_at")
    .eq("content_item_id", params.id).order("created_at", { ascending: true });

  if (!item) return <p>Item não encontrado.</p>;
  const u = item.understanding ?? {};
  const r = item.rank_rationale ?? {};

  return (
    <div>
      {searchParams?.msg && (
        <div className="card" style={{ borderColor: "var(--accent)", whiteSpace: "pre-wrap", fontSize: 13 }}>
          {searchParams.msg}
        </div>
      )}
      <h2>{item.title || "(sem título)"}</h2>
      <p><span className="badge">{item.status}</span>{" "}
        {item.external_url && <a className="muted" href={item.external_url} target="_blank">fonte ↗</a>}
      </p>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Acionar etapas manualmente</h3>
          <div className="row" style={{ gap: 8 }}>
            <form action={runAllSteps}>
              <AutoRefresh />
              <input type="hidden" name="id" value={item.id} />
              <SubmitButton className="btn" style={{ background: "var(--accent)", color: "#000", borderColor: "var(--accent)" }} confirmMessage="Processar todas as etapas restantes para esta pauta?">Executar Todas de uma vez</SubmitButton>
            </form>
            <form action={async () => {
              "use server";
              try {
                const db = supabaseAdmin();
                const { error: e1 } = await db.from("pipeline_runs").delete().eq("content_item_id", item.id);
                if (e1) console.error("Erro ao apagar logs:", e1);
                const { error: e2 } = await db.from("content_items").delete().eq("id", item.id);
                if (e2) console.error("Erro ao apagar item:", e2);
              } catch (err) {
                console.error("Exceção ao excluir:", err);
              }
              redirect("/pipeline");
            }}>
              <SubmitButton className="btn" style={{ background: "var(--red)", borderColor: "var(--red)" }} confirmMessage="Tem certeza absoluta que deseja excluir esta pauta?">Excluir Pauta</SubmitButton>
            </form>
          </div>
        </div>
        <div className="row">
          {(["understand", "rank", "write", "polish"] as const).map((s) => (
            <form action={runOneStep} key={s}>
              <AutoRefresh />
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="step" value={s} />
              <SubmitButton className="btn secondary">{s}</SubmitButton>
            </form>
          ))}
        </div>
      </div>

      {item.transcript && (
        <div className="card"><h3>1 · Entendimento</h3>
          <p className="muted">{(u as any).summary}</p>
          <details><summary>Transcrição</summary><pre style={{ whiteSpace: "pre-wrap" }}>{item.transcript}</pre></details>
        </div>
      )}
      {item.rank_score != null && (
        <div className="card"><h3>2 · Ranking — nota {item.rank_score}</h3>
          <p className="muted">{(r as any).rationale}</p>
          <p><strong>Manchete sugerida:</strong> {(r as any).suggested_headline}</p>
        </div>
      )}
      {item.draft && (
        <div className="card"><h3>3 · Rascunho</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{item.draft}</pre>
        </div>
      )}
      {item.final_article && (
        <div className="card"><h3>4 · Final + SEO</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{item.final_article}</pre>
          <details><summary>SEO</summary><pre>{JSON.stringify(item.seo, null, 2)}</pre></details>
        </div>
      )}

      <div className="card">
        <h3>Execuções</h3>
        <table>
          <thead><tr><th>Etapa</th><th>Modelo</th><th>Status</th><th>Duração</th></tr></thead>
          <tbody>
            {(runs ?? []).map((x: any, i: number) => (
              <tr key={i}><td>{x.step}</td><td className="muted">{x.model}</td>
                <td><span className="badge">{x.status}</span></td><td>{x.duration_ms} ms</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
