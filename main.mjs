import express from "express";
// readFileSyncは不要になるため削除します
// import { readFileSync } from "node:fs";
const app = express();

app.use(express.static("."));

app.get("/", (request, response) => {
  // response.send(readFileSync("./home/home.html", "utf-8"));
  // ルートURLへのアクセスを /home/home.html にリダイレクトします。
  // これにより、HTML内のCSSやJSファイルへの相対パスが正しく解決されるようになります。
  response.redirect("/home/home.html");
});


app.listen(3000);