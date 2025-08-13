import readline from "readline";
import axios from "axios";
import { exec } from "child_process";
import util from "util";
require('dotenv').config();

const execPromise = util.promisify(exec);

// === CONFIG ===
const MODEL = "llama3"; // Change to any Ollama model installed
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-20b";

// === Mode Selection ===
const USE_GROQ = GROQ_API_KEY.trim().length > 0;

// === Input Interface ===
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// === AI Functions ===
async function askOllama(prompt) {
  try {
    const cmd = `ollama run ${MODEL} "${prompt.replace(/"/g, '\\"')}"`;
    const { stdout } = await execPromise(cmd);
    return stdout.trim();
  } catch (err) {
    return `❌ Ollama Error: ${err.message}`;
  }
}

async function askGroq(prompt) {
  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }]
      },
      {
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    return `❌ Groq API Error: ${err.response?.data?.error?.message || err.message}`;
  }
}

// === Main Chat Loop ===
async function chat() {
  console.log(USE_GROQ ? "☁️ Using Groq AI (Cloud)..." : "💻 Using Ollama (Local)...");

  rl.question("\nYou: ", async (userInput) => {
    if (userInput.toLowerCase() === "exit") {
      console.log("👋 Goodbye!");
      rl.close();
      return;
    }

    let aiResponse;
    if (USE_GROQ) {
      aiResponse = await askGroq(userInput);
    } else {
      aiResponse = await askOllama(userInput);
    }

    console.log(`\nAI: ${aiResponse}\n`);
    chat(); // Loop again
  });
}

chat();
