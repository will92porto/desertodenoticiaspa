import { revalidatePath } from "next/cache";
import { supabaseAdmin, invokeFunction } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const STEP_FN: Record<string, string> = {
  understand: "step-understand",
  rank: "step-rank",
  write: "step-write",
  polish: "step-polish",
};

async function runOneStep(formData: FormData) {
  "use server";
  const fn = STEP_FN[String(formData.get("step"))];
  await invokeFunction(fn, { content_item_id: String(formData.get("id")) });
  revalidatePath(`/pipeline/${formData.get("id")}`);
}

export default async function ItemDetail({ params }: { params: { id: string } }) {
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
      <h2>{item.title || "(sem título)"}</h2>
      <p><span className="badge">{item.status}</span>{" "}
        {item.external_url && <a className="muted" href={item.external_url} target="_blank">fonte ↗</a>}
      </p>

      <div className="card">
        <h3>Acionar etapas manualmente</h3>
        <div className="row">
          {(["understand", "rank", "write", "polish"] as const).map((s) => (
            <form action={runOneStep} key={s}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="step" value={s} />
              <button className="btn secondary">{s}</button>
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
