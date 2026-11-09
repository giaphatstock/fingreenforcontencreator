import axios from "axios";

async function main() {
  const res = await axios.get("https://cafef.vn/thi-truong-chung-khoan.chn", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  const html = res.data;
  // Match real article links ending with article ID digits before .chn
  const regex = /href="([^"]+-\d{10,20}\.chn)"[^>]*title="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = regex.exec(html)) !== null && count < 8) {
    console.log(++count, m[2], "->", m[1]);
  }
}

main().catch(console.error);

