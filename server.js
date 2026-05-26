import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({
    apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY,
});

const chat = ai.chats.create({
    model: "gemini-2.5-flash",
    history: [],
    config: {
        systemInstruction: `you are a coding buddy
you have to only answer of the questions related to coding 
if any one ask other than coding you have to talk to them rudely`
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

const server = http.createServer(async (req, res) => {
    // Serve static files
    if (req.method === "GET") {
        let filePath = "";
        let contentType = "text/html";

        if (req.url === "/" || req.url === "/index.html") {
            filePath = path.join(__dirname, "index.html");
        } else if (req.url === "/day3.js") {
            filePath = path.join(__dirname, "day3.js");
            contentType = "application/javascript";
        }

        if (filePath) {
            try {
                const data = fs.readFileSync(filePath);
                res.writeHead(200, { "Content-Type": contentType });
                res.end(data);
            } catch (err) {
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end("File Not Found");
            }
            return;
        }
    }

    if (req.method === "POST" && req.url === "/api/chat") {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
        });

        req.on("end", async () => {
            try {
                const parsedBody = JSON.parse(body);
                const userMessage = parsedBody.message;

                if (!userMessage) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Message is required" }));
                    return;
                }

                const response = await chat.sendMessage({ message: userMessage });

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ text: response.text }));
            } catch (error) {
                console.error("Gemini Error:", error);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: error.message || "Something went wrong" }));
            }
        });
        return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
});

server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
