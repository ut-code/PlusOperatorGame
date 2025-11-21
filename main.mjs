import express from "express";
import path from 'path'; 
import { fileURLToPath } from 'url'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'home')));

app.use(express.static(path.join(__dirname, 'play')));


app.get("/", (request, response) => {
  response.sendFile(path.join(__dirname, 'home', 'home.html'));
});

app.get("/play", (request, response) => {
  response.sendFile(path.join(__dirname, 'play', 'play.html'));
});
app.get("/health", (request, response) => {
  response.send("OK");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
