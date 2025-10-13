import express from "express";
import { readFileSync } from "node:fs";
const app = express();

app.use(express.static("home/page"));

app.get("/", (request, response) => {
  response.send(readFileSync("./home/page/home.html", "utf-8"));
});


app.listen(3000);