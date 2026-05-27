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

class TokenBucketLimiter {
    constructor(rate = 15, capacity = 15, intervalMs = 60000) {
        this.rate = rate;
        this.capacity = capacity;
        this.intervalMs = intervalMs;
        this.buckets = new Map();
    }

    _refill(bucket, now) {
        const timePassed = now - bucket.lastRefillTime;
        const tokensToAdd = (timePassed / this.intervalMs) * this.rate;
        bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
        bucket.lastRefillTime = now;
    }

    tryConsume(ip, count = 1) {
        const now = Date.now();
        if (!this.buckets.has(ip)) {
            this.buckets.set(ip, {
                tokens: this.capacity,
                lastRefillTime: now
            });
        }

        const bucket = this.buckets.get(ip);
        this._refill(bucket, now);

        if (bucket.tokens >= count) {
            bucket.tokens -= count;
            return true;
        }
        return false;
    }

    cleanup(expiryMs = 5 * 60 * 1000) {
        const now = Date.now();
        for (const [ip, bucket] of this.buckets.entries()) {
            if (now - bucket.lastRefillTime > expiryMs) {
                this.buckets.delete(ip);
            }
        }
    }
}

const limiter = new TokenBucketLimiter(15, 15, 60000);

const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 10 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions.entries()) {
        if (now - session.lastActive > SESSION_TTL) {
            sessions.delete(sid);
        }
    }
    limiter.cleanup();
}, CLEANUP_INTERVAL);

async function callGeminiWithRetry(chatInstance, message, maxRetries = 3) {
    let delay = 1000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await chatInstance.sendMessage({ message });
            return response;
        } catch (error) {
            console.error(`Gemini API attempt ${attempt} failed:`, error.message || error);
            
            const errorMsg = (error.message || "").toLowerCase();
            const isRateLimit = errorMsg.includes("429") || errorMsg.includes("resource exhausted") || errorMsg.includes("rate limit");
            const isServerError = errorMsg.includes("503") || errorMsg.includes("service unavailable") || errorMsg.includes("overloaded");

            if ((isRateLimit || isServerError) && attempt < maxRetries) {
                console.log(`Transient Gemini error. Retrying in ${delay}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2;
            } else {
                throw error;
            }
        }
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

const server = http.createServer(async (req, res) => {
    if (req.method === "GET") {
        let filePath = "";
        let contentType = "text/html";

        if (req.url === "/" || req.url === "/index.html") {
            filePath = path.join(__dirname, "index.html");
        } else if (req.url === "/dom.js") {
            filePath = path.join(__dirname, "dom.js");
            contentType = "application/javascript";
        } else if (req.url === "/logo.png") {
            filePath = path.join(__dirname, "logo.png");
            contentType = "image/png";
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
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        if (!limiter.tryConsume(ip)) {
            res.writeHead(429, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Too many requests. Please wait a minute and try again." }));
            return;
        }

        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
        });

        req.on("end", async () => {
            try {
                const parsedBody = JSON.parse(body);
                const userMessage = parsedBody.message;
                const sessionId = parsedBody.sessionId;
                const model = parsedBody.model || "gemini-2.5-flash";

                if (!userMessage) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Message is required" }));
                    return;
                }

                if (!sessionId) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Session ID is required" }));
                    return;
                }

                let session = sessions.get(sessionId);
                if (!session) {
                    session = { history: [], lastActive: Date.now() };
                    sessions.set(sessionId, session);
                } else {
                    session.lastActive = Date.now();
                }

                const chatInstance = ai.chats.create({
                    model: model,
                    history: session.history,
                    config: {
                        systemInstruction: `you are a coding buddy
you have to only answer of the questions related to coding 
if any one ask other than coding you have to talk to them rudely`
                    }
                });

                const response = await callGeminiWithRetry(chatInstance, userMessage);

                session.history = chatInstance.getHistory().slice(-10);

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

    if (req.method === "POST" && req.url === "/api/clear") {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
        });

        req.on("end", () => {
            try {
                const parsedBody = JSON.parse(body);
                const sessionId = parsedBody.sessionId;
                
                if (sessionId && sessions.has(sessionId)) {
                    sessions.delete(sessionId);
                }

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid request format" }));
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
