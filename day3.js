const chatBox = document.getElementById("chat");
const input = document.getElementById("input");
const send = document.getElementById("send");

function addMessage(role, text) {
    const div = document.createElement("div");
    div.className = `message ${role}`;
    
    if (role === "gemini") {
        div.innerHTML = marked.parse(text);
    } else {
        div.textContent = text;
    }
    
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

async function handleSend() {
    const question = input.value.trim();
    if (!question) return;
    addMessage("user", question);
    input.value = "";
    
    input.disabled = true;
    send.disabled = true;

    const loadingDiv = document.createElement("div");
    loadingDiv.className = "message gemini loading";
    loadingDiv.textContent = "Thinking...";
    chatBox.appendChild(loadingDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ message: question })
        });

        const data = await response.json();
        
        loadingDiv.remove();

        if (data.text) {
            addMessage("gemini", data.text);
        } else if (data.error) {
            addMessage("gemini", "Error: " + data.error);
        } else {
            addMessage("gemini", "Received an invalid response from server.");
        }
    } catch (error) {
        loadingDiv.remove();
        addMessage("gemini", "Failed to connect to the server.");
        console.error("Fetch error:", error);
    } finally {
        input.disabled = false;
        send.disabled = false;
        input.focus();
    }
}


send.addEventListener("click", handleSend);


input.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
        handleSend();
    }
});
