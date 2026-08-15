async function test() {
  const url = 'https://saavn-api.vercel.app/search/songs?query=kesariya';
  const res = await fetch(url);
  const data = await res.json();
  console.log(JSON.stringify(data[0] || data, null, 2));
}
test();
