async function test() {
  const res = await fetch("https://www.diariomunicipal.com.br/famep/load/83E3B677");
  const html = await res.text();
  console.log("Length:", html.length);
  console.log(html.slice(0, 500));
}
test();
