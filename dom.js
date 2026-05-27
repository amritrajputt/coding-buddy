const chatBox = document.getElementById("chat");
const input = document.getElementById("input");
const send = document.getElementById("send");
const landingContainer = document.getElementById("landing-container");
const chatArea = document.getElementById("chat-area");

let currentModel = "gemini-2.5-flash";

let sessionId = sessionStorage.getItem("sessionId");
if (!sessionId) {
    sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessionStorage.setItem("sessionId", sessionId);
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.copyToClipboard = function(id) {
    const codeEl = document.getElementById(id);
    if (!codeEl) return;
    
    const text = codeEl.textContent;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById(id + "-btn");
        if (btn) {
            const btnSpan = btn.querySelector("span");
            const originalText = btnSpan.textContent;
            btnSpan.textContent = "Copied!";
            setTimeout(() => {
                btnSpan.textContent = originalText;
            }, 2000);
        }
    }).catch(err => {
        console.error("Failed to copy text: ", err);
    });
};

if (window.marked) {
    const renderer = new marked.Renderer();
    renderer.code = function(code, language) {
        const cleanCode = typeof code === 'object' ? code.text : code;
        const lang = language || 'code';
        const id = 'code-' + Math.random().toString(36).substring(2, 9);
        return `
            <pre>
                <div class="code-header">
                    <span>${lang}</span>
                    <button class="copy-btn" onclick="copyToClipboard('${id}')" id="${id}-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>Copy code</span>
                    </button>
                </div>
                <code id="${id}" class="language-${lang}">${escapeHtml(cleanCode)}</code>
            </pre>
        `;
    };
    marked.setOptions({ renderer });
}

const landingTitle = document.getElementById("landing-title");
if (landingTitle) {
    const text = "Ready when you are";
    landingTitle.innerHTML = `<span id="typing-text"></span><span class="typing-cursor"></span>`;
    const typingTextSpan = document.getElementById("typing-text");
    let idx = 0;
    function typeChar() {
        if (idx < text.length) {
            typingTextSpan.textContent += text.charAt(idx);
            idx++;
            setTimeout(typeChar, 85);
        }
    }
    setTimeout(typeChar, 400);
}

input.addEventListener("input", () => {
    input.style.height = "auto";
    const newHeight = input.scrollHeight;
    if (newHeight > 120) {
        input.style.height = "120px";
        input.style.overflowY = "auto";
    } else {
        input.style.height = newHeight + "px";
        input.style.overflowY = "hidden";
    }
    
    if (input.value.trim().length > 0) {
        send.disabled = false;
    } else {
        send.disabled = true;
    }
});

function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
}

function addMessageRow(role, text) {
    const row = document.createElement("div");
    row.className = `message-row ${role}`;
    
    if (role === "gemini") {
        row.innerHTML = `
            <div class="message-content">
                ${window.marked ? marked.parse(text) : text}
            </div>
        `;
    } else {
        row.innerHTML = `
            <div class="message-content">
                ${escapeHtml(text).replace(/\n/g, "<br>")}
            </div>
        `;
    }
    
    chatBox.appendChild(row);
    scrollToBottom();
}

async function handleSend() {
    const question = input.value.trim();
    if (!question) return;

    if (landingContainer.style.display !== "none") {
        landingContainer.style.display = "none";
        chatBox.style.display = "flex";
    }

    addMessageRow("user", question);
    
    input.value = "";
    input.style.height = "auto";
    send.disabled = true;
    input.focus();

    const loaderRow = document.createElement("div");
    loaderRow.className = "message-row gemini";
    loaderRow.id = "loader-row";
    loaderRow.innerHTML = `
        <div class="message-content">
            <div class="dots-loader">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    chatBox.appendChild(loaderRow);
    scrollToBottom();

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ 
                message: question, 
                sessionId: sessionId,
                model: currentModel
            })
        });

        const data = await response.json();
        
        loaderRow.remove();

        if (response.status === 429) {
            const errDiv = document.createElement("div");
            errDiv.className = "error-message";
            errDiv.textContent = data.error || "Rate limit exceeded. Please try again in a minute.";
            chatBox.appendChild(errDiv);
            scrollToBottom();
        } else if (response.ok && data.text) {
            addMessageRow("gemini", data.text);
        } else if (data.error) {
            const errDiv = document.createElement("div");
            errDiv.className = "error-message";
            errDiv.textContent = "Error: " + data.error;
            chatBox.appendChild(errDiv);
            scrollToBottom();
        } else {
            const errDiv = document.createElement("div");
            errDiv.className = "error-message";
            errDiv.textContent = "Received an invalid response from server.";
            chatBox.appendChild(errDiv);
            scrollToBottom();
        }
    } catch (error) {
        loaderRow.remove();
        const errDiv = document.createElement("div");
        errDiv.className = "error-message";
        errDiv.textContent = "Failed to connect to the server.";
        chatBox.appendChild(errDiv);
        scrollToBottom();
        console.error("Fetch error:", error);
    }
}

send.addEventListener("click", handleSend);

input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSend();
    }
});
