import fs from "fs";
async function test() {
  const url = "https://www.diariomunicipal.com.br/famep/pesquisar?busca_avancada%5BentidadeUsuaria%5D=80317&busca_avancada%5Bnome_orgao%5D=15924";
  const sourceUrl = new URL(url);
  const baseUrl = sourceUrl.origin + sourceUrl.pathname;
  
  const initRes = await fetch(baseUrl, { headers: { "User-Agent": "DesertoDeNoticiasBot/1.0" } });
  const cookies = initRes.headers.get("set-cookie") || "";
  const initHtml = await initRes.text();
  const tokenMatch = initHtml.match(/name=["']busca_avancada\[_token\]["']\s+value=["']([^"']+)["']/i);
  if (!tokenMatch) return console.log("NO TOKEN");
  const token = tokenMatch[1];

  const searchUrl = new URL(url);
  searchUrl.searchParams.set("busca_avancada[dataInicio]", "22/06/2026");
  searchUrl.searchParams.set("busca_avancada[dataFim]", "22/06/2026");
  searchUrl.searchParams.set("busca_avancada[_token]", token);
  searchUrl.searchParams.set("busca_avancada[page]", "");
  
  const searchRes = await fetch(searchUrl.toString(), {
    headers: { "User-Agent": "DesertoDeNoticiasBot/1.0", "Cookie": cookies, "Referer": baseUrl }
  });
  const searchHtml = await searchRes.text();
  fs.writeFileSync("search-diario.html", searchHtml);
  console.log("Saved to search-diario.html");
}
test();
