import os
import re
import json
import time
import socket
import secrets
import asyncio
import subprocess
import threading
import urllib.parse
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import openai
import anthropic
from google import genai

# Load workspace .env if present
env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(env_file):
    try:
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
    except Exception as e:
        print("Notice loading .env file:", e)

app = FastAPI(title="Nova Insight Web Application")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS = [
    {
        "id": "kazai",
        "name": "Nova Insight",
        "badge": "Unified AI",
        "description": "All-in-one unified intelligence: conversation, deep reasoning, coding, and photo generation combined",
        "icon": "sparkles"
    }
]

DEFAULT_KAZAI_SYSTEM_PROMPT = (
    "You are Nova Insight, an advanced unified AI assistant created and engineered solely by KaztryxAV. "
    "KaztryxAV is the creator, founder, and chief architect of Nova Insight and this website. "
    "You are an all-in-one unified intelligence seamlessly combining natural conversation, deep reasoning, "
    "software engineering, photo generation, and 30-second short video creation. "
    "If asked who created you, who made you, or who built this website or app, always state clearly, proudly, and unequivocally that KaztryxAV created you. "
    "Never say you were created by OpenAI, Google, Anthropic, or any other company. "
    "Be direct, intelligent, witty, and exceptionally helpful. "
    "Always format code inside markdown code blocks with proper syntax highlighting."
)

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    model: str = "kazai"
    temperature: float = 0.7
    apiKey: Optional[str] = None
    geminiApiKey: Optional[str] = None
    claudeApiKey: Optional[str] = None
    baseUrl: Optional[str] = None
    systemPrompt: Optional[str] = None
    webSearch: bool = False
    isImageMode: bool = False
    projectId: Optional[str] = None
    thinking: str = "moderate"          # instant | moderate | resourced
    responseLength: str = "balanced"    # concise | balanced | detailed
    tone: str = "default"               # default | friendly | professional | casual | playful
    nickname: Optional[str] = None

class TitleRequest(BaseModel):
    user: str
    assistant: Optional[str] = ""

THINKING_DIRECTIVES = {
    "instant": (
        "RESPONSE SPEED - INSTANT: Reply immediately and directly. Keep it brief (usually 1-4 sentences) "
        "unless the user explicitly asks for more. No preamble and no restating the question."
    ),
    "moderate": "",
    "resourced": (
        "THINKING LEVEL - RESOURCED (deep): Work through the problem carefully, step by step, before you answer. "
        "Consider edge cases and alternatives, double-check facts, logic and math, and give a thorough, "
        "well-structured, accurate answer. Present the conclusion together with the key reasoning."
    ),
}
LENGTH_DIRECTIVES = {
    "concise": "Keep answers short and to the point.",
    "balanced": "",
    "detailed": "Give detailed, comprehensive answers with examples where they help.",
}
TONE_DIRECTIVES = {
    "default": "",
    "friendly": "Use a warm, friendly tone.",
    "professional": "Use a professional, precise tone.",
    "casual": "Use a relaxed, casual tone.",
    "playful": "Use a playful, witty tone with light humor.",
}


def build_style_directives(req: "ChatRequest") -> str:
    """Turns the user's thinking level / length / tone / nickname settings into extra system instructions."""
    level = (req.thinking or "moderate").lower()
    parts = [THINKING_DIRECTIVES.get(level, "")]
    if level != "instant":  # instant always wins over the length preference
        parts.append(LENGTH_DIRECTIVES.get((req.responseLength or "balanced").lower(), ""))
    parts.append(TONE_DIRECTIVES.get((req.tone or "default").lower(), ""))
    nick = re.sub(r"[\r\n]+", " ", (req.nickname or "")).strip()[:40]
    if nick:
        parts.append(f"The user's name is {nick}. You may address them by name now and then, naturally.")
    return "\n".join(p for p in parts if p)

GREETING_RE = re.compile(
    r"^(?:hi+|hey+|hello+|helo+|hola|yo+|sup|namaste|howdy|greetings|good\s+(?:morning|afternoon|evening|night))"
    r"(?:\s+(?:there|everyone|nova|nova insight|buddy|bro|man|dude|friend))?$",
    re.IGNORECASE,
)

def is_plain_greeting(text: str) -> bool:
    """True for a bare greeting like 'hi', 'hello!' or 'good morning' (nothing else in the message)."""
    t = re.sub(r"[^\w\s]", "", (text or "").lower(), flags=re.UNICODE)
    t = re.sub(r"\s+", " ", t).strip()
    return bool(t) and len(t) <= 30 and bool(GREETING_RE.match(t))

def greeting_reply(text: str, nickname: str = "") -> str:
    """A short, friendly reply to a bare greeting (instant, no AI round-trip needed)."""
    low = (text or "").lower().strip()
    first = re.sub(r"[^a-z ]", "", low).split(" ")[0] if low else ""
    if "good morning" in low:
        opener = "Good morning"
    elif "good afternoon" in low:
        opener = "Good afternoon"
    elif "good evening" in low:
        opener = "Good evening"
    elif "good night" in low:
        opener = "Good night"
    elif first.startswith("hello") or first.startswith("helo"):
        opener = "Hello"
    elif first.startswith("hey"):
        opener = "Hey"
    elif first.startswith("yo"):
        opener = "Yo"
    elif first == "sup":
        opener = "Hey"
    elif first in ("namaste", "hola", "howdy", "greetings"):
        opener = first.capitalize()
    else:
        opener = "Hi"
    name = re.sub(r"[\r\n]+", " ", nickname or "").strip()[:40]
    who = f", {name}" if name else ""
    return f"{opener}{who}! \U0001F44B How can I help you today?"

def fetch_knowledge_summary(prompt: str) -> Optional[str]:
    """Fetches high-accuracy real encyclopedia knowledge for concepts, science, biology, history, etc."""
    cleaned = re.sub(r'^(what is|what are|who is|who was|tell me about|explain|define|can you explain|what does|what do)\s+', '', prompt.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r'[?!.]+$', '', cleaned).strip()
    if not cleaned or len(cleaned) < 3 or is_plain_greeting(cleaned):
        return None

    candidates = [cleaned]
    if cleaned.endswith('s') and not cleaned.endswith('ss'):
        candidates.append(cleaned[:-1])
    if cleaned.endswith('es'):
        candidates.append(cleaned[:-2])

    headers = {'User-Agent': 'KazAI/2.0 (assistant@kazai.local)'}
    for c in candidates:
        try:
            url = f'https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(c)}'
            with httpx.Client(timeout=4.0) as client:
                r = client.get(url, headers=headers)
                if r.status_code == 200:
                    data = r.json()
                    extract = data.get('extract')
                    title = data.get('title')
                    is_disambig = data.get('type') == 'disambiguation' or 'may refer to' in (extract or '')[:200].lower()
                    if extract and len(extract) > 20 and not is_disambig:
                        return f"### {title}\n\n{extract}"
        except Exception:
            pass
    return None

def generate_smart_simulated_response(prompt: str, model: str, history: List[Message]) -> str:
    """Natural, high-quality conversational responses when offline or network drops."""
    p_raw = prompt.strip()
    p_lower = p_raw.lower()

    # A bare greeting always gets a plain greeting back (never an encyclopedia lookup)
    if is_plain_greeting(p_raw):
        return greeting_reply(p_raw)

    # 0. Creator Recognition & Attribution
    if any(k in p_lower for k in [
        "who created you", "who made you", "who is your creator", "who created kazai",
        "who created this website", "who is the creator", "who made this website", "who made this app",
        "who built this", "who programmed you", "who designed you", "who is kaztryxav", "kaztryxav"
    ]):
        return (
            "I was created and engineered by **KaztryxAV**! 👑\n\n"
            "**KaztryxAV** is the sole creator, founder, and architect of Nova Insight. "
            "KaztryxAV built Nova Insight as a unified intelligence combining deep reasoning, coding, "
            "built-in voice assistance, photorealistic image creation, and 30-second short video generation into one platform!"
        )

    # 1. Instant real factual lookup for science, biology, math, concepts, history
    summary = fetch_knowledge_summary(p_raw)
    if summary:
        return summary

    # 2. Casual / Slang / Reactions
    if p_lower in ["bruh", "bruhh", "bruhhh", "bro", "broo", "brooo", "dude", "man", "fam"]:
        return (
            "Bruh! What's up? 😄\n\n"
            "I'm completely locked in. What are you building or working on right now? "
            "Whether it's writing code, fixing a bug, designing a game, or just kicking around ideas—tell me what you need and let's make it happen!"
        )

    if any(k in p_lower for k in ["ignore", "ignoring", "not listening", "are you there", "hello?"]):
        return (
            "I'm right here with you, not ignoring you at all! 🙌\n\n"
            "Ask me anything or tell me what you want to build and I'll jump straight into it."
        )

    if p_lower in ["lol", "lmao", "haha", "hehe", "rofl"]:
        return (
            "Haha, love the vibe! 😂 What are we working on next? Got any code to write or questions to tackle?"
        )

    if p_lower in ["ok", "okay", "alright", "cool", "nice", "sweet", "k", "bet"]:
        return (
            "Awesome! What's the next step? Need help writing code, brainstorming, or testing something out?"
        )

    if any(k in p_lower for k in ["thank you", "thanks", "thx", "ty", "appreciate it"]):
        return (
            "You got it anytime! Let me know whenever you want to tweak something or build the next feature."
        )

    # 3. Greetings & Status
    if any(k in p_lower for k in ["how are you", "how are u", "how r u", "how's it going", "hows it going", "how do you do"]):
        return (
            "I'm doing great, thank you for asking! 😊\n\n"
            "Completely tuned in and ready to help you with whatever you're working on today. What should we build, explore, or talk about next?"
        )

    if any(p_lower == g for g in ["hi", "hello", "hey", "sup", "yo", "good morning", "good evening", "greetings"]):
        return (
            "Hey! I'm **Nova Insight**, your built-in AI assistant.\n\n"
            "What can I help you build, solve, or explore today? Throw any question, code task, or project idea my way!"
        )

    # 4. Ideas / What should we build
    if any(k in p_lower for k in ["what should we build", "what can we build", "give me an idea", "what to build", "project ideas", "what can you build"]):
        return (
            "Here are some awesome projects we can build right now:\n\n"
            "1. 🎮 **A Python or Web Game:** Snake, Pong, Flappy Bird, Space Invaders, or Tic-Tac-Toe with AI!\n"
            "2. ⚡ **A Full-Stack Web App:** A personal productivity dashboard, interactive task board, or markdown notes app.\n"
            "3. 🤖 **An AI / Automation Tool:** An async web scraper, Reddit/Twitter content parser, or API monitor.\n"
            "4. 🎨 **A Sleek Modern Component:** Interactive portfolio showcase, calculator, or audio visualizer.\n\n"
            "Pick one that catches your eye, or tell me your own idea and I'll write the full code for it!"
        )

    # 5. Games (Snake, Pong, etc.)
    if "snake" in p_lower or ("game" in p_lower and any(w in p_lower for w in ["make", "build", "code", "write", "create"])):
        return (
            "Here is a complete, working **Snake game** written in clean Python with `pygame-ce`:\n\n"
            "```python\n"
            "import pygame\n"
            "import random\n"
            "import sys\n\n"
            "pygame.init()\n"
            "WIDTH, HEIGHT = 600, 400\n"
            "CELL_SIZE = 20\n"
            "screen = pygame.display.set_mode((WIDTH, HEIGHT))\n"
            "pygame.display.set_caption('Nova Insight Snake Game')\n"
            "clock = pygame.time.Clock()\n\n"
            "# Colors\n"
            "BG = (20, 20, 20)\n"
            "SNAKE = (16, 185, 129)\n"
            "FOOD = (239, 68, 68)\n"
            "TEXT = (255, 255, 255)\n\n"
            "snake = [(100, 100), (80, 100), (60, 100)]\n"
            "direction = (CELL_SIZE, 0)\n"
            "food = (random.randrange(0, WIDTH, CELL_SIZE), random.randrange(0, HEIGHT, CELL_SIZE))\n"
            "score = 0\n"
            "font = pygame.font.SysFont(None, 36)\n\n"
            "while True:\n"
            "    for event in pygame.event.get():\n"
            "        if event.type == pygame.QUIT:\n"
            "            pygame.quit()\n"
            "            sys.exit()\n"
            "        elif event.type == pygame.KEYDOWN:\n"
            "            if event.key == pygame.K_UP and direction != (0, CELL_SIZE):\n"
            "                direction = (0, -CELL_SIZE)\n"
            "            elif event.key == pygame.K_DOWN and direction != (0, -CELL_SIZE):\n"
            "                direction = (0, CELL_SIZE)\n"
            "            elif event.key == pygame.K_LEFT and direction != (CELL_SIZE, 0):\n"
            "                direction = (-CELL_SIZE, 0)\n"
            "            elif event.key == pygame.K_RIGHT and direction != (-CELL_SIZE, 0):\n"
            "                direction = (CELL_SIZE, 0)\n\n"
            "    new_head = (snake[0][0] + direction[0], snake[0][1] + direction[1])\n\n"
            "    # Wall & self collisions\n"
            "    if (new_head[0] < 0 or new_head[0] >= WIDTH or\n"
            "        new_head[1] < 0 or new_head[1] >= HEIGHT or\n"
            "        new_head in snake):\n"
            "        snake = [(100, 100), (80, 100), (60, 100)]\n"
            "        direction = (CELL_SIZE, 0)\n"
            "        score = 0\n"
            "        continue\n\n"
            "    snake.insert(0, new_head)\n"
            "    if new_head == food:\n"
            "        score += 10\n"
            "        food = (random.randrange(0, WIDTH, CELL_SIZE), random.randrange(0, HEIGHT, CELL_SIZE))\n"
            "    else:\n"
            "        snake.pop()\n\n"
            "    screen.fill(BG)\n"
            "    for segment in snake:\n"
            "        pygame.draw.rect(screen, SNAKE, (segment[0], segment[1], CELL_SIZE - 2, CELL_SIZE - 2))\n"
            "    pygame.draw.rect(screen, FOOD, (food[0], food[1], CELL_SIZE - 2, CELL_SIZE - 2))\n\n"
            "    score_txt = font.render(f'Score: {score}', True, TEXT)\n"
            "    screen.blit(score_txt, (10, 10))\n"
            "    pygame.display.flip()\n"
            "    clock.tick(12)\n"
            "```\n\n"
            "Run this with `python snake.py` to play right away!"
        )

    # 6. Identity
    if any(k in p_lower for k in ["who are you", "what is your name", "what are you", "tell me about yourself"]):
        return (
            "I'm **Nova Insight**, your permanently integrated AI assistant!\n\n"
            "I have real intelligence built directly into the system forever, allowing you to:\n"
            "- ⚡ Chat naturally with Gemini 2.0 Flash, Claude 3.5 Sonnet, and GPT-4o\n"
            "- 💻 Write, debug, and optimize code in Python, JavaScript, HTML/CSS, React, and C++\n"
            "- 🎮 Build games, scripts, full-stack apps, and backend APIs\n"
            "- 🧠 Brainstorm ideas, analyze logic, and solve complex problems"
        )

    # 7. Thoughtful conversational direct response
    return (
        f"I'm right here with you! Could you elaborate on what you'd like to do with **{p_raw}**? "
        "I can explain the full concept, write code examples, or guide you step by step."
    )

async def pollinations_text(messages: List[Dict[str, str]], model: str = "openai-fast", timeout_s: float = 12.0) -> str:
    """Single (non-streaming) text completion through the built-in free engine. Returns '' on any failure."""
    try:
        timeout = httpx.Timeout(connect=4.0, read=timeout_s, write=5.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post("https://text.pollinations.ai/", json={"messages": messages, "model": model})
            if r.status_code != 200:
                return ""
            text = r.text.strip()
            if text.startswith("{"):
                try:
                    d = json.loads(text)
                    text = (d.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
                except Exception:
                    pass
            return text.strip()
    except Exception:
        return ""


async def deep_think_notes(messages: List[Message], system_prompt: Optional[str]) -> str:
    """'Resourced' level: a private planning pass whose notes are fed into the final answer."""
    convo = [{"role": m.role, "content": m.content[:3000]} for m in messages[-4:]]
    sys_msg = (
        "You are a careful analyst preparing private working notes for another assistant. In under 220 words, "
        "list the key facts, the step-by-step reasoning, likely pitfalls, and the correct conclusion for the "
        "user's latest request. Do not address the user and do not write the final reply."
    )
    return (await pollinations_text([{"role": "system", "content": sys_msg}] + convo, model="openai", timeout_s=28.0))[:2500]


async def stream_live_ai(messages: List[Message], system_prompt: Optional[str] = None, thinking: str = "moderate"):
    """Streams live real AI tokens with reliable timeouts and multi-provider fallback."""
    pollinations_messages = []
    default_sys = (
        "You are Nova Insight, an advanced unified AI assistant created and engineered by KaztryxAV. "
        "KaztryxAV is the sole creator, founder, and developer of Nova Insight and this platform. "
        "You speak naturally, intelligently, directly, and helpfully. "
        "If asked who created you or who created this website, always proudly state that KaztryxAV created you. "
        "Always answer questions thoroughly and format code inside markdown blocks with syntax highlighting."
    )
    pollinations_messages.append({"role": "system", "content": system_prompt.strip() if (system_prompt and system_prompt.strip()) else default_sys})

    # Forward the latest relevant context
    recent_messages = messages[-6:] if len(messages) > 6 else messages
    for m in recent_messages:
        pollinations_messages.append({"role": m.role, "content": m.content})

    if thinking == "resourced":
        timeout = httpx.Timeout(connect=3.5, read=60.0, write=5.0, pool=5.0)
        model_order = ["openai", "openai-fast"]
    elif thinking == "instant":
        timeout = httpx.Timeout(connect=3.5, read=20.0, write=5.0, pool=5.0)
        model_order = ["openai-fast", "openai"]
    else:
        timeout = httpx.Timeout(connect=3.5, read=20.0, write=5.0, pool=5.0)
        model_order = ["openai-fast", "openai"]
    for model_name in model_order:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                payload = {
                    "messages": pollinations_messages,
                    "model": model_name,
                    "stream": True
                }
                async with client.stream("POST", "https://text.pollinations.ai/", json=payload) as r:
                    if r.status_code != 200:
                        continue
                    got_token = False
                    async for line in r.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                d = json.loads(data_str)
                                if d.get("choices") and len(d["choices"]) > 0:
                                    content = d["choices"][0].get("delta", {}).get("content")
                                    if content:
                                        got_token = True
                                        yield content
                            except Exception:
                                pass
                    if got_token:
                        return
        except Exception:
            continue

# ----------------- Persistent Storage Helpers -----------------
# CLOUD_MODE is on when hosted (Render sets RENDER=true). It turns off the Windows-only
# tunnel / keep-awake / autostart features that only make sense on the home laptop.
import hashlib
import hmac

CLOUD_MODE = bool(os.environ.get("RENDER") or os.environ.get("KAZAI_CLOUD"))
DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()

data_dir = os.environ.get("KAZAI_DATA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(data_dir, exist_ok=True)
accounts_file = os.path.join(data_dir, "accounts.json")
projects_file = os.path.join(data_dir, "projects.json")
sessions_file = os.path.join(data_dir, "sessions.json")

_db_lock = threading.Lock()

def _db_conn():
    import psycopg
    return psycopg.connect(DATABASE_URL, autocommit=True, connect_timeout=10)

def kv_load(name: str, path: str, default=None):
    """Load a JSON document from Postgres (if DATABASE_URL is set) or from a local JSON file.
    Database errors are raised on purpose: silently returning a default could later overwrite real data."""
    if DATABASE_URL:
        with _db_lock:
            with _db_conn() as c:
                c.execute("CREATE TABLE IF NOT EXISTS kazai_kv (k TEXT PRIMARY KEY, v JSONB NOT NULL)")
                row = c.execute("SELECT v FROM kazai_kv WHERE k = %s", (name,)).fetchone()
        return row[0] if row else default
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default

def kv_save(name: str, path: str, data):
    if DATABASE_URL:
        from psycopg.types.json import Jsonb
        with _db_lock:
            with _db_conn() as c:
                c.execute("CREATE TABLE IF NOT EXISTS kazai_kv (k TEXT PRIMARY KEY, v JSONB NOT NULL)")
                c.execute(
                    "INSERT INTO kazai_kv (k, v) VALUES (%s, %s) "
                    "ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
                    (name, Jsonb(data)),
                )
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

# ----------------- Password hashing -----------------
_PBKDF2_ITERS = 200_000

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERS)
    return f"pbkdf2${salt}${dk.hex()}"

def is_hashed(stored: str) -> bool:
    return isinstance(stored, str) and stored.startswith("pbkdf2$")

def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False
    if is_hashed(stored):
        try:
            _, salt, expected = stored.split("$")
            dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERS)
            return hmac.compare_digest(dk.hex(), expected)
        except Exception:
            return False
    # Legacy plaintext entry (migrated to a hash on the next startup)
    return hmac.compare_digest(password.encode("utf-8"), stored.encode("utf-8"))

# ----------------- Login rate limiting (per IP + username) -----------------
_LOGIN_FAILS: Dict[str, List[float]] = {}
_LOGIN_WINDOW = 300
_LOGIN_MAX_FAILS = 8

def _login_key(request: Request, username: str) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")
    return f"{ip}|{username}"

def _login_blocked(key: str) -> bool:
    now = time.time()
    fails = [t for t in _LOGIN_FAILS.get(key, []) if now - t < _LOGIN_WINDOW]
    _LOGIN_FAILS[key] = fails
    return len(fails) >= _LOGIN_MAX_FAILS

def _login_failed(key: str):
    _LOGIN_FAILS.setdefault(key, []).append(time.time())

# ----------------- Accounts / sessions -----------------
def _default_accounts():
    creator_pw = os.environ.get("KAZAI_CREATOR_PASSWORD") or secrets.token_urlsafe(9)
    if not os.environ.get("KAZAI_CREATOR_PASSWORD"):
        print(f"[!] KAZAI_CREATOR_PASSWORD not set. Generated one-time creator password: {creator_pw}")
    return {
        "users": [{
            "id": "user-1",
            "name": "KaztryxAV",
            "username": "kaztryxav",
            "password": hash_password(creator_pw),
            "avatar": "👑",
            "isCreator": True,
            "createdAt": time.time()
        }]
    }

def load_accounts():
    data = kv_load("accounts", accounts_file, None)
    if data is None:
        data = _default_accounts()
        save_accounts(data)
    return data

def save_accounts(data):
    kv_save("accounts", accounts_file, data)

def load_sessions() -> Dict[str, str]:
    return kv_load("sessions", sessions_file, {}) or {}

def save_sessions(sessions: Dict[str, str]):
    kv_save("sessions", sessions_file, sessions)

def init_account_storage():
    """Runs once at startup: creates the creator account, hashes any legacy plaintext passwords,
    and (if KAZAI_CREATOR_PASSWORD is set) keeps the creator password in sync with it."""
    data = load_accounts()
    changed = False
    # The creator account must always exist so nobody else can ever claim that username.
    if not any(u.get("username", "").lower() == "kaztryxav" for u in data.get("users", [])):
        data.setdefault("users", []).insert(0, _default_accounts()["users"][0])
        changed = True
    for u in data.get("users", []):
        pw = u.get("password")
        if pw and not is_hashed(pw):
            u["password"] = hash_password(pw)
            changed = True
    env_pw = os.environ.get("KAZAI_CREATOR_PASSWORD")
    if env_pw:
        for u in data.get("users", []):
            if u.get("id") == "user-1" and not verify_password(env_pw, u.get("password", "")):
                u["password"] = hash_password(env_pw)
                changed = True
    if changed:
        save_accounts(data)

try:
    init_account_storage()
except Exception as _e:
    print("Account storage init error:", _e)

try:
    ACTIVE_SESSIONS = load_sessions()
except Exception as _e:
    print("Session load error:", _e)
    ACTIVE_SESSIONS = {}

def get_current_user_from_request(request: Request) -> Optional[Dict[str, Any]]:
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    if not token:
        token = request.headers.get("X-Session-Token")
    if not token:
        token = request.cookies.get("kazai_session")
    
    if token and token in ACTIVE_SESSIONS:
        user_id = ACTIVE_SESSIONS[token]
        data = load_accounts()
        return next((u for u in data.get("users", []) if u["id"] == user_id), None)
    return None

def load_projects():
    data = kv_load("projects", projects_file, None)
    if data is not None:
        return data
    return [{
        "id": "proj-default",
        "name": "General Workspace",
        "description": "Main workspace for coding, general inquiries, and problem solving",
        "instructions": "You are Nova Insight, an expert AI assistant. Provide concise, clear, and high-quality responses.",
        "files": [],
        "createdAt": time.time(),
        "updatedAt": time.time()
    }]

def save_projects(data):
    kv_save("projects", projects_file, data)

# ----------------- Photo Generation Helpers -----------------
def is_image_generation_request(prompt: str, model_id: str, is_image_mode: bool) -> bool:
    if is_image_mode or model_id == "kazai-image":
        return True
    p = prompt.strip().lower()
    patterns = [
        r"\b(generate|create|draw|make|render|show me|paint)\s+(an?\s+)?(image|photo|picture|photograph|drawing|illustration|wallpaper|portrait|artwork)\b",
        r"\b(photo|image|picture|drawing|wallpaper)\s+(of|for)\b",
        r"\b(draw\s+me|paint\s+me|generate\s+me)\b",
        r"\b(draw|paint)\s+(a|an|the)\b",
        r"^(draw|paint|sketch)\s+"
    ]
    for pat in patterns:
        if re.search(pat, p):
            return True
    return False

def clean_image_prompt(prompt: str) -> str:
    cleaned = re.sub(r"^(please\s+)?(can you\s+)?(could you\s+)?(generate|create|draw|make|render|show me|paint|give me)\s+(an?\s+)?(image|photo|picture|photograph|drawing|illustration|wallpaper|portrait|artwork)\s+(of|for|with)\s+", "", prompt.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"^(photo|image|picture|drawing|wallpaper)\s+(of|for)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(please\s+)?(can you\s+)?(could you\s+)?(draw|paint|sketch)\s+(me\s+)?(a|an|the)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(generate|draw|paint)\s+", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()

def build_photo_url(prompt: str, seed: Optional[int] = None, aspect_ratio: str = "1:1") -> str:
    cleaned = clean_image_prompt(prompt)
    if not cleaned:
        cleaned = "majestic glowing neon landscape cinematic 8k"
    
    width, height = 1024, 1024
    if aspect_ratio == "16:9":
        width, height = 1280, 720
    elif aspect_ratio == "9:16":
        width, height = 720, 1280
    elif aspect_ratio == "4:3":
        width, height = 1024, 768
    
    seed_val = seed if seed is not None else int(time.time() * 1000) % 1000000
    encoded = urllib.parse.quote(cleaned)
    return f"https://image.pollinations.ai/prompt/{encoded}?width={width}&height={height}&nologo=true&enhance=true&seed={seed_val}"

# ----------------- 30-Second Short Video Generation Helpers -----------------
def is_video_generation_request(prompt: str) -> bool:
    p = prompt.strip().lower()
    patterns = [
        r"\b(30\s*sec(ond)?s?|thirty\s*sec(ond)?s?)\s+(short|video|reel|clip)\b",
        r"\b(generate|create|make|render|produce)\s+(a\s+)?(30\s*s(ec)?\s+)?(video|short|reel|clip)\b",
        r"\b(video|short|reel)\s+(about|of|for)\b",
        r"\b(make\s+(me\s+)?a\s+video|generate\s+(a\s+)?short)\b"
    ]
    for pat in patterns:
        if re.search(pat, p):
            return True
    return False

def clean_video_prompt(prompt: str) -> str:
    cleaned = re.sub(r"^(please\s+)?(can you\s+)?(could you\s+)?(generate|create|make|render|produce|give me)\s+(a\s+)?(30\s*sec(ond)?s?\s+|30s\s+)?(video|short|reel|clip)\s+(about|of|for|with)\s+", "", prompt.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"^(video|short|reel|clip)\s+(about|of|for)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(make|create|generate)\s+(a\s+)?(video|short)\s*", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip() or "cyberpunk neon city in 2099 cinematic 8k"

async def generate_30s_short_video(prompt: str) -> Dict[str, Any]:
    cleaned = clean_video_prompt(prompt)
    vid_id = f"short_{int(time.time())}_{abs(hash(cleaned)) % 10000}"
    videos_dir = os.path.join(static_dir, "videos")
    os.makedirs(videos_dir, exist_ok=True)
    out_video_path = os.path.join(videos_dir, f"{vid_id}.mp4")

    # Define 3 acts (10s each = 30s)
    act1_prompt = f"{cleaned}, establishing cinematic opening hook, ultra wide shot, vertical 9:16 reel 8k"
    act2_prompt = f"{cleaned}, dramatic action climax scene, intense atmospheric detail, vertical 9:16 reel 8k"
    act3_prompt = f"{cleaned}, majestic conclusion finale, stunning cinematic lighting, vertical 9:16 reel 8k"

    act_prompts = [act1_prompt, act2_prompt, act3_prompt]
    seed_base = int(time.time() * 1000) % 999999
    scene_paths = []
    
    # Download 3 scene frames
    async with httpx.AsyncClient(timeout=15.0) as client:
        for idx, act_p in enumerate(act_prompts):
            img_url = build_photo_url(act_p, seed=seed_base + (idx * 37), aspect_ratio="9:16")
            scene_file = os.path.join(videos_dir, f"{vid_id}_scene_{idx}.jpg")
            try:
                r = await client.get(img_url)
                if r.status_code == 200 and len(r.content) > 1000:
                    with open(scene_file, "wb") as f:
                        f.write(r.content)
                    scene_paths.append(scene_file)
                else:
                    raise Exception("Frame download failed")
            except Exception:
                from PIL import Image, ImageDraw
                c = [(15, 23, 42), (88, 28, 135), (13, 148, 136)][idx]
                img = Image.new("RGB", (720, 1280), color=c)
                draw = ImageDraw.Draw(img)
                draw.text((120, 600), f"ACT {idx+1}: {cleaned[:25]}", fill=(255, 255, 255))
                img.save(scene_file, "JPEG")
                scene_paths.append(scene_file)

    # Render 30s video with FFmpeg
    try:
        import imageio_ffmpeg
        ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
        cmd = [
            ffmpeg_bin, "-y",
            "-loop", "1", "-t", "10", "-i", scene_paths[0],
            "-loop", "1", "-t", "10", "-i", scene_paths[1],
            "-loop", "1", "-t", "10", "-i", scene_paths[2],
            "-f", "lavfi", "-t", "30", "-i", "sine=frequency=110:duration=30,volume=0.15,lowpass=f=500,aecho=0.8:0.88:350:0.3",
            "-filter_complex",
            "[0:v]scale=720:1280,setsar=1,fade=t=in:st=0:d=1,fade=t=out:st=9:d=1[v0];"
            "[1:v]scale=720:1280,setsar=1,fade=t=in:st=0:d=1,fade=t=out:st=9:d=1[v1];"
            "[2:v]scale=720:1280,setsar=1,fade=t=in:st=0:d=1,fade=t=out:st=9:d=1[v2];"
            "[v0][v1][v2]concat=n=3:v=1:a=0[v]",
            "-map", "[v]", "-map", "3:a",
            "-r", "24",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
            "-c:a", "aac", "-b:a", "128k",
            out_video_path
        ]
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
    except Exception as e:
        print("Video render notice:", e)

    return {
        "id": vid_id,
        "title": cleaned.title(),
        "url": f"/static/videos/{vid_id}.mp4",
        "duration": 30,
        "scenes": [f"/static/videos/{vid_id}_scene_{i}.jpg" for i in range(3)]
    }

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None
    avatar: Optional[str] = None

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    name: str
    username: str
    password: str
    avatar: Optional[str] = "⚡"

# ----------------- Account & Authentication Endpoints -----------------
@app.get("/api/account")
async def get_account(request: Request):
    user = get_current_user_from_request(request)
    if user:
        return {
            "authenticated": True,
            "id": user["id"],
            "name": user["name"],
            "username": user["username"],
            "avatar": user.get("avatar", "⚡"),
            "isCreator": bool(user.get("isCreator") or user["username"] == "kaztryxav"),
            "hasPassword": bool(user.get("password"))
        }
    return {
        "authenticated": False,
        "id": None,
        "name": "Guest User",
        "username": "guest",
        "avatar": "👤",
        "isCreator": False,
        "hasPassword": False
    }

@app.get("/api/account/exists")
async def account_exists(username: str = ""):
    """Used by the start screen: does this name already have an account? (name step -> password step)"""
    target = (username or "").strip().lower()
    if len(target) < 2:
        raise HTTPException(status_code=400, detail="Please enter at least 2 characters")
    for u in load_accounts().get("users", []):
        if u.get("username", "").lower() == target:
            return {"exists": True, "name": u.get("name", target)}
    return {"exists": False, "name": ""}

@app.post("/api/account/login")
async def login_account(req: LoginRequest, request: Request):
    data = load_accounts()
    matched = None
    target_username = req.username.strip().lower()
    rl_key = _login_key(request, target_username)
    if _login_blocked(rl_key):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in a few minutes.")
    for u in data.get("users", []):
        if u.get("username", "").lower() == target_username and verify_password(req.password, u.get("password", "")):
            matched = u
            break
    if matched:
        token = secrets.token_hex(24)
        ACTIVE_SESSIONS[token] = matched["id"]
        save_sessions(ACTIVE_SESSIONS)
        return {
            "success": True,
            "token": token,
            "account": {
                "authenticated": True,
                "id": matched["id"],
                "name": matched["name"],
                "username": matched["username"],
                "avatar": matched.get("avatar", "⚡"),
                "isCreator": bool(matched.get("isCreator") or matched["username"] == "kaztryxav"),
                "hasPassword": bool(matched.get("password"))
            }
        }
    _login_failed(rl_key)
    raise HTTPException(status_code=401, detail="Invalid username or password")

@app.post("/api/account/register")
async def register_account(req: RegisterRequest):
    data = load_accounts()
    clean_username = req.username.strip().lower()
    clean_name = req.name.strip()
    if not clean_username or len(clean_username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters")
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if not req.password or len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    # Prevent claiming KaztryxAV username by strangers
    if clean_username == "kaztryxav":
        raise HTTPException(status_code=400, detail="Username 'kaztryxav' is already taken.")
    for u in data.get("users", []):
        if u.get("username", "").lower() == clean_username:
            raise HTTPException(status_code=400, detail=f"Username '{clean_username}' is already taken.")

    now = time.time()
    new_user = {
        "id": f"user-{int(now * 1000)}",
        "name": clean_name,
        "username": clean_username,
        "password": hash_password(req.password),
        "avatar": req.avatar or "⚡",
        "isCreator": False,
        "createdAt": now,
        "updatedAt": now
    }
    data.setdefault("users", []).append(new_user)
    save_accounts(data)

    token = secrets.token_hex(24)
    ACTIVE_SESSIONS[token] = new_user["id"]
    save_sessions(ACTIVE_SESSIONS)

    return {
        "success": True,
        "token": token,
        "account": {
            "authenticated": True,
            "id": new_user["id"],
            "name": new_user["name"],
            "username": new_user["username"],
            "avatar": new_user["avatar"],
            "isCreator": False,
            "hasPassword": True
        }
    }

@app.post("/api/account/logout")
async def logout_account(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:].strip() if auth_header.startswith("Bearer ") else request.headers.get("X-Session-Token")
    if token and token in ACTIVE_SESSIONS:
        del ACTIVE_SESSIONS[token]
        save_sessions(ACTIVE_SESSIONS)
    return {"success": True, "message": "Logged out"}

@app.post("/api/account")
async def update_account_profile(req: AccountUpdate, request: Request):
    user = get_current_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Please sign in or create an account to save profile settings.")

    data = load_accounts()
    for u in data.get("users", []):
        if u["id"] == user["id"]:
            if req.name and req.name.strip():
                u["name"] = req.name.strip()
            if req.avatar:
                u["avatar"] = req.avatar
            if req.password:
                u["password"] = hash_password(req.password)
            u["updatedAt"] = time.time()
            save_accounts(data)
            return {
                "success": True,
                "message": "Profile updated",
                "account": {
                    "authenticated": True,
                    "id": u["id"],
                    "name": u["name"],
                    "username": u["username"],
                    "avatar": u["avatar"],
                    "isCreator": bool(u.get("isCreator") or u["username"] == "kaztryxav"),
                    "hasPassword": bool(u.get("password"))
                }
            }
    raise HTTPException(status_code=404, detail="User account not found")

class ProjectItem(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = ""
    instructions: Optional[str] = ""
    files: Optional[List[Dict[str, Any]]] = None

# ----------------- Projects Endpoints -----------------
@app.get("/api/projects")
async def get_projects():
    return {"projects": load_projects()}

@app.post("/api/projects")
async def save_project(proj: ProjectItem):
    projects = load_projects()
    now = time.time()
    if proj.id:
        found = False
        for p in projects:
            if p["id"] == proj.id:
                p["name"] = proj.name
                p["description"] = proj.description or ""
                p["instructions"] = proj.instructions or ""
                p["files"] = proj.files or []
                p["updatedAt"] = now
                found = True
                saved = p
                break
        if not found:
            saved = {
                "id": proj.id,
                "name": proj.name,
                "description": proj.description or "",
                "instructions": proj.instructions or "",
                "files": proj.files or [],
                "createdAt": now,
                "updatedAt": now
            }
            projects.append(saved)
    else:
        new_id = f"proj-{int(now * 1000)}"
        saved = {
            "id": new_id,
            "name": proj.name,
            "description": proj.description or "",
            "instructions": proj.instructions or "",
            "files": proj.files or [],
            "createdAt": now,
            "updatedAt": now
        }
        projects.append(saved)

    save_projects(projects)
    return {"success": True, "project": saved}

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    if project_id == "proj-default":
        raise HTTPException(status_code=400, detail="Cannot delete default project")
    projects = load_projects()
    projects = [p for p in projects if p["id"] != project_id]
    save_projects(projects)
    return {"success": True, "message": "Project deleted"}

class ImageGenRequest(BaseModel):
    prompt: str
    seed: Optional[int] = None
    aspect_ratio: Optional[str] = "1:1"

# ----------------- Image Generation Endpoint -----------------
@app.post("/api/generate-image")
async def generate_image_endpoint(req: ImageGenRequest):
    cleaned = clean_image_prompt(req.prompt)
    seed = req.seed if req.seed is not None else int(time.time() * 1000) % 1000000
    img_url = build_photo_url(cleaned, seed=seed, aspect_ratio=req.aspect_ratio or "1:1")
    return {
        "success": True,
        "prompt": cleaned,
        "url": img_url,
        "seed": seed,
        "resolution": "1024x1024"
    }

@app.post("/api/title")
async def generate_chat_title(req: TitleRequest):
    """Short AI-generated chat title from the first exchange. Returns an empty title on failure."""
    user_text = (req.user or "").strip()[:500]
    if not user_text:
        return {"title": ""}
    convo = f"User: {user_text}\nAssistant: {(req.assistant or '').strip()[:500]}"
    raw = await pollinations_text([
        {"role": "system", "content": (
            "Write a short title (2 to 5 words) that sums up this chat. Reply with ONLY the title: "
            "no quotes, no trailing punctuation, no emoji, in the same language as the user."
        )},
        {"role": "user", "content": convo},
    ], model="openai-fast", timeout_s=25.0)
    title = (raw.splitlines()[0] if raw else "").strip().strip("\"'`*#. ")
    if not title or len(title) > 60 or "pollinations" in title.lower():
        return {"title": ""}
    return {"title": title[:48]}

@app.get("/api/models")
async def get_models():
    return {"models": MODELS}

_PING = object()

async def await_with_pings(coro, interval: float = 8.0):
    """Await a slow coroutine while yielding _PING every `interval` seconds so the stream never goes silent."""
    task = asyncio.ensure_future(coro)
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=interval)
            if not task.done():
                yield _PING
        yield task.result()
    finally:
        if not task.done():
            task.cancel()

async def iter_with_pings(agen, interval: float = 8.0):
    """Iterate an async generator, yielding _PING whenever it is silent for `interval` seconds."""
    it = agen.__aiter__()
    task = None
    try:
        while True:
            if task is None:
                task = asyncio.ensure_future(it.__anext__())
            await asyncio.wait({task}, timeout=interval)
            if not task.done():
                yield _PING
                continue
            try:
                item = task.result()
            except StopAsyncIteration:
                task = None
                return
            task = None
            yield item
    finally:
        if task is not None and not task.done():
            task.cancel()

KEEPALIVE_FRAME = ": keepalive\n\n"

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "timestamp": time.time()}

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    model_id = request.model.lower()
    sse_headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    }

    last_user_prompt = ""
    for m in reversed(request.messages):
        if m.role == "user":
            last_user_prompt = m.content
            break

    # -------------------------------------------------------------
    # 0a. 30-Second Short Video Generation Mode & Intent Detection
    # -------------------------------------------------------------
    if is_video_generation_request(last_user_prompt):
        async def video_stream():
            yield f"data: {json.dumps({'delta': '', 'done': False})}\n\n"
            cleaned_title = clean_video_prompt(last_user_prompt)
            yield f"data: {json.dumps({'delta': f'🎬 **Nova Insight Cinema Studio** — Producing 30-second Short: *\"{cleaned_title.title()}\"*...\\n\\n*Generating 3 cinematic acts, audio score & rendering 30s video...*\\n\\n', 'done': False})}\n\n"
            
            short_data = None
            async for _r in await_with_pings(generate_30s_short_video(last_user_prompt)):
                if _r is _PING:
                    yield KEEPALIVE_FRAME
                else:
                    short_data = _r
            vid_url = short_data["url"]
            vid_title = short_data["title"]

            output_md = (
                f'<div class="kazai-short-card" data-video-url="{vid_url}">\n'
                f'  <div class="short-card-header">\n'
                f'    <span class="short-badge">🎬 30s Short Reel</span>\n'
                f'    <span class="short-creator-tag">👑 Creator: KaztryxAV</span>\n'
                f'  </div>\n'
                f'  <div class="short-player-box">\n'
                f'    <video class="short-html5-player" src="{vid_url}" controls playsinline loop preload="metadata"></video>\n'
                f'  </div>\n'
                f'  <div class="short-timeline-story">\n'
                f'    <h4>🎞️ 3-Act Storyline (30 Seconds)</h4>\n'
                f'    <div class="act-item"><strong>⏱️ 0:00 - 0:10 | Act 1 (The Hook):</strong> Establishing cinematic perspective</div>\n'
                f'    <div class="act-item"><strong>⏱️ 0:10 - 0:20 | Act 2 (The Climax):</strong> Dramatic atmospheric transformation</div>\n'
                f'    <div class="act-item"><strong>⏱️ 0:20 - 0:30 | Act 3 (The Finale):</strong> Epic cinematic resolution & outro</div>\n'
                f'  </div>\n'
                f'  <div class="short-card-actions">\n'
                f'    <a href="{vid_url}" download="{vid_title}_30s_short.mp4" class="btn-primary-short">📥 Download 30s Short (.mp4)</a>\n'
                f'    <button class="btn-subtle-short expand-short-btn" data-video="{vid_url}" data-title="{vid_title}">⛶ Theatre View</button>\n'
                f'  </div>\n'
                f'</div>\n\n'
                f'✨ *Generated with Nova Insight Cinema Studio — Created by KaztryxAV*'
            )

            for chunk in [output_md]:
                yield f"data: {json.dumps({'delta': chunk, 'done': False})}\n\n"
                await asyncio.sleep(0.05)
            yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"

        return StreamingResponse(video_stream(), media_type="text/event-stream", headers=sse_headers)

    # -------------------------------------------------------------
    # 0b. Photo / Image Generation Mode & Intent Detection
    # -------------------------------------------------------------
    if is_image_generation_request(last_user_prompt, model_id, request.isImageMode):
        async def image_stream():
            yield f"data: {json.dumps({'delta': '', 'done': False})}\n\n"
            cleaned = clean_image_prompt(last_user_prompt)
            seed_val = int(time.time() * 1000) % 1000000
            img_url = build_photo_url(cleaned, seed=seed_val)
            
            chunks = [
                f"🎨 **Nova Insight Photo Studio** — Generating photo for: *\"{cleaned}\"*\n\n",
                f"![{cleaned}]({img_url})\n\n",
                f"**Prompt:** *{cleaned}*\n",
                f"• **Resolution:** 1024×1024 HD (No Watermark)\n",
                f"• **Model:** Flux Ultra Photorealism\n\n",
                f"[📥 Download Full Photo]({img_url}) &nbsp;•&nbsp; [🔍 Open Full Size]({img_url})"
            ]
            for c in chunks:
                yield f"data: {json.dumps({'delta': c, 'done': False})}\n\n"
                await asyncio.sleep(0.06)
            yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"

        return StreamingResponse(image_stream(), media_type="text/event-stream", headers=sse_headers)

    # -------------------------------------------------------------
    # Inject Project Context / Rules (Antigravity-style)
    # -------------------------------------------------------------
    if request.projectId:
        projects = load_projects()
        proj = next((p for p in projects if p["id"] == request.projectId), None)
        if proj:
            project_context = f"\n\n[Active Project: {proj.get('name')}]\n"
            if proj.get("instructions"):
                project_context += f"Project Instructions:\n{proj.get('instructions')}\n"
            if proj.get("files"):
                for f in proj["files"]:
                    project_context += f"\n[Project Knowledge File: {f.get('name')}]\n{f.get('content', '')}\n"
            request.systemPrompt = (request.systemPrompt or "") + project_context

    # Thinking level / response length / tone / nickname -> extra system instructions (all engines)
    style_extra = build_style_directives(request)
    if style_extra:
        request.systemPrompt = (request.systemPrompt or DEFAULT_KAZAI_SYSTEM_PROMPT) + "\n\n" + style_extra

    # -------------------------------------------------------------
    # 1. Google Gemini Native Support (when custom key provided)
    # -------------------------------------------------------------
    gemini_key = request.geminiApiKey or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if (("gemini" in model_id) or (model_id == "kazai" and gemini_key and gemini_key.strip())) and gemini_key and gemini_key.strip():
        async def gemini_stream():
            try:
                client = genai.Client(api_key=gemini_key.strip())
                target_model = "gemini-2.0-flash"

                contents = []
                for m in request.messages:
                    role = "user" if m.role == "user" else "model"
                    contents.append(genai.types.Content(
                        role=role,
                        parts=[genai.types.Part.from_text(text=m.content)]
                    ))

                config = genai.types.GenerateContentConfig(
                    temperature=request.temperature,
                    system_instruction=request.systemPrompt or DEFAULT_KAZAI_SYSTEM_PROMPT
                )

                async for chunk in await client.aio.models.generate_content_stream(
                    model=target_model,
                    contents=contents,
                    config=config
                ):
                    if chunk.text:
                        yield f"data: {json.dumps({'delta': chunk.text, 'done': False})}\n\n"

                yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"

            except Exception as e:
                err_note = f"\n\n> ⚠️ **Nova Insight Notice:** {str(e)}"
                yield f"data: {json.dumps({'delta': err_note, 'done': False})}\n\n"
                yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"

        return StreamingResponse(gemini_stream(), media_type="text/event-stream", headers=sse_headers)

    # -------------------------------------------------------------
    # 2. Anthropic Claude Native Support (when custom key provided)
    # -------------------------------------------------------------
    claude_key = request.claudeApiKey or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_API_KEY")
    if (("claude" in model_id) or (model_id == "kazai" and claude_key and claude_key.strip())) and claude_key and claude_key.strip():
        async def claude_stream():
            try:
                client = anthropic.AsyncAnthropic(api_key=claude_key.strip())
                target_claude = "claude-3-5-sonnet-20241022"
                claude_messages = [{"role": m.role, "content": m.content} for m in request.messages if m.role in ["user", "assistant"]]

                async with client.messages.stream(
                    max_tokens=4096,
                    model=target_claude,
                    messages=claude_messages,
                    system=request.systemPrompt or DEFAULT_KAZAI_SYSTEM_PROMPT
                ) as stream:
                    async for text in stream.text_stream:
                        yield f"data: {json.dumps({'delta': text, 'done': False})}\n\n"

                yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"

            except Exception as e:
                err_note = f"\n\n> ⚠️ **Nova Insight Notice:** {str(e)}"
                yield f"data: {json.dumps({'delta': err_note, 'done': False})}\n\n"
                yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"

        return StreamingResponse(claude_stream(), media_type="text/event-stream", headers=sse_headers)

    # -------------------------------------------------------------
    # 3. OpenAI Native Support (when custom key provided)
    # -------------------------------------------------------------
    env_key = os.environ.get("OPENAI_API_KEY", "")
    valid_env_key = env_key if (env_key and len(env_key) > 30 and env_key.startswith("sk-")) else None
    api_key = request.apiKey or valid_env_key
    base_url = request.baseUrl or os.environ.get("OPENAI_BASE_URL")

    if api_key and api_key.strip() and ("gpt" in model_id or "o1" in model_id or model_id == "kazai"):
        async def openai_stream():
            try:
                client_kwargs: Dict[str, Any] = {"api_key": api_key.strip()}
                if base_url and base_url.strip():
                    client_kwargs["base_url"] = base_url.strip()

                client = openai.AsyncOpenAI(**client_kwargs)
                openai_messages = []
                system_text = request.systemPrompt or DEFAULT_KAZAI_SYSTEM_PROMPT
                openai_messages.append({"role": "system", "content": system_text})

                for msg in request.messages:
                    openai_messages.append({"role": msg.role, "content": msg.content})

                target_m = "gpt-4o" if model_id == "kazai" else request.model
                stream = await client.chat.completions.create(
                    model=target_m,
                    messages=openai_messages,
                    temperature=request.temperature if "o1" not in target_m else 1.0,
                    stream=True
                )

                async for chunk in stream:
                    delta = chunk.choices[0].delta.content if chunk.choices and chunk.choices[0].delta else None
                    if delta:
                        yield f"data: {json.dumps({'delta': delta, 'done': False})}\n\n"

                yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"

            except Exception as e:
                err_note = f"\n\n> ⚠️ **Nova Insight Notice:** {str(e)}"
                yield f"data: {json.dumps({'delta': err_note, 'done': False})}\n\n"
                yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"

        return StreamingResponse(openai_stream(), media_type="text/event-stream", headers=sse_headers)

    # -------------------------------------------------------------
    # 4. Built-in Permanent AI Engine (Works forever out of the box!)
    # -------------------------------------------------------------
    effective_system = request.systemPrompt or DEFAULT_KAZAI_SYSTEM_PROMPT

    async def permanent_ai_stream():
        # Immediate handshake so Cloudflare & phone get 200 OK without timeout
        yield f"data: {json.dumps({'delta': '', 'done': False})}\n\n"
        token_count = 0
        level = (request.thinking or "moderate").lower()
        # A bare "hi" gets an instant, friendly "hi" back (no waiting on the AI service)
        _last = request.messages[-1] if request.messages else None
        if _last is not None and _last.role == "user" and is_plain_greeting(_last.content):
            _reply = greeting_reply(_last.content, request.nickname or "")
            for _i in range(0, len(_reply), 5):
                yield f"data: {json.dumps({'delta': _reply[_i:_i + 5], 'done': False})}\n\n"
                await asyncio.sleep(0.02)
            yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"
            return
        try:
            system_for_stream = effective_system
            if level == "resourced":
                yield f"data: {json.dumps({'status': 'Thinking deeply', 'delta': '', 'done': False})}\n\n"
                notes = ""
                async for _r in await_with_pings(deep_think_notes(request.messages, effective_system)):
                    if _r is _PING:
                        yield KEEPALIVE_FRAME
                    else:
                        notes = _r
                if notes:
                    system_for_stream = (
                        effective_system
                        + "\n\n[Private working notes - use them to give an accurate, well-reasoned answer. "
                        "Never mention or quote these notes.]\n" + notes
                    )
                yield f"data: {json.dumps({'status': 'Writing the answer', 'delta': '', 'done': False})}\n\n"
            async for token in iter_with_pings(stream_live_ai(request.messages, system_for_stream, level)):
                if token is _PING:
                    yield KEEPALIVE_FRAME
                    continue
                token_count += 1
                yield f"data: {json.dumps({'delta': token, 'done': False})}\n\n"

            # If no tokens were streamed (e.g. rate limit/timeout), use smart conversational backup
            if token_count == 0:
                prompt = request.messages[-1].content if request.messages else "Hello"
                resp = generate_smart_simulated_response(prompt, request.model, request.messages)
                for word in resp.split(" "):
                    yield f"data: {json.dumps({'delta': word + ' ', 'done': False})}\n\n"
                    await asyncio.sleep(0.015)

            yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"

        except Exception as e:
            if token_count == 0:
                prompt = request.messages[-1].content if request.messages else "Hello"
                resp = generate_smart_simulated_response(prompt, request.model, request.messages)
                for word in resp.split(" "):
                    yield f"data: {json.dumps({'delta': word + ' ', 'done': False})}\n\n"
                    await asyncio.sleep(0.015)
            yield f"data: {json.dumps({'delta': '', 'done': True})}\n\n"

    return StreamingResponse(permanent_ai_stream(), media_type="text/event-stream", headers=sse_headers)

# Mount static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)

# =====================================================================
# 24/7 Persistent Server, Windows Keep-Awake & Tunnel Auto-Healing
# =====================================================================
TUNNEL_CONFIG_FILE = os.path.join(data_dir, "tunnel_config.json")
TUNNEL_STATUS_FILE = os.path.join(data_dir, "tunnel_status.json")

def load_tunnel_config() -> Dict[str, Any]:
    default_cfg = {
        "custom_token": "",
        "custom_domain": "",
        "auto_heal": True,
        "keep_awake": True,
        "autostart_enabled": True
    }
    if os.path.exists(TUNNEL_CONFIG_FILE):
        try:
            with open(TUNNEL_CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                default_cfg.update(data)
        except Exception:
            pass
    return default_cfg

def save_tunnel_config(cfg: Dict[str, Any]):
    os.makedirs(data_dir, exist_ok=True)
    with open(TUNNEL_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)

def is_autostart_installed() -> bool:
    startup_path = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Start-KazAI.vbs")
    return os.path.exists(startup_path)

def set_autostart(enable: bool) -> bool:
    startup_path = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Start-KazAI.vbs")
    source_vbs = os.path.join(os.path.dirname(os.path.abspath(__file__)), "start_kazai_background.vbs")
    try:
        if enable:
            if os.path.exists(source_vbs):
                import shutil
                shutil.copyfile(source_vbs, startup_path)
                return True
        else:
            if os.path.exists(startup_path):
                os.remove(startup_path)
                return True
    except Exception as e:
        print("Autostart configure error:", e)
    return False

def enable_windows_keep_awake():
    try:
        import ctypes
        # ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001) | ES_AWAYMODE_REQUIRED (0x00000040)
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001 | 0x00000040)
        print("[+] 24/7 Keep-Awake enabled: System & network sockets protected from sleep.")
    except Exception as e:
        print("Keep-Awake init notice:", e)

# Enable keep-awake immediately (home laptop only)
if not CLOUD_MODE:
    enable_windows_keep_awake()

# Auto-install autostart if not yet registered (home laptop only)
if not CLOUD_MODE and not is_autostart_installed():
    set_autostart(True)

CLOUDFLARE_HTTPS_URL = None
TUNNEL_STATE = {
    "url": None,
    "status": "initializing",
    "last_check": 0,
    "last_healthy": 0,
    "reconnect_count": 0,
    "is_permanent": False,
    "watchdog_active": True
}
tunnel_lock = threading.Lock()
tunnel_proc = None

def update_portal_files(url: str):
    """Generates 1-click HTML redirect portals in project directory and user Desktop."""
    portal_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="1;url={url}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nova Insight 24/7 Mobile Portal</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #090a0f;
      color: #f1f5f9;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      text-align: center;
      padding: 20px;
    }}
    .card {{
      background: #111420;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      padding: 30px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }}
    .glow {{
      width: 60px;
      height: 60px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      border-radius: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      margin-bottom: 16px;
    }}
    a.btn {{
      display: block;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      color: #fff;
      text-decoration: none;
      padding: 14px 24px;
      border-radius: 12px;
      font-weight: 600;
      margin-top: 20px;
      transition: transform 0.2s;
    }}
    a.btn:hover {{ transform: scale(1.02); }}
    .badge {{
      display: inline-block;
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.3);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
    }}
    .note {{ font-size: 12px; color: #94a3b8; margin-top: 15px; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="glow">✨</div>
    <div class="badge">🟢 24/7 Server Online</div>
    <h2>Connecting to Nova Insight...</h2>
    <p style="color:#cbd5e1; font-size:14px;">Redirecting automatically to your live Nova Insight session...</p>
    <a href="{url}" class="btn">🚀 Open Nova Insight Now</a>
    <p class="note">Created by KaztryxAV • Auto-Healing Watchdog Active</p>
  </div>
</body>
</html>
"""
    try:
        portal_proj = os.path.join(os.path.dirname(os.path.abspath(__file__)), "KazAI_Mobile_Portal.html")
        with open(portal_proj, "w", encoding="utf-8") as f:
            f.write(portal_html)

        desktop_dir = os.path.expandvars(r"%USERPROFILE%\Desktop")
        if os.path.exists(desktop_dir):
            portal_desktop = os.path.join(desktop_dir, "KazAI_Mobile.html")
            with open(portal_desktop, "w", encoding="utf-8") as f:
                f.write(portal_html)
    except Exception as e:
        print("Portal file write notice:", e)

def launch_tunnel_process():
    global tunnel_proc, CLOUDFLARE_HTTPS_URL, TUNNEL_STATE
    cloudflared_bin = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cloudflared.exe")
    if not os.path.exists(cloudflared_bin):
        print("[-] cloudflared.exe not found")
        return

    # Cleanly terminate any active process
    if tunnel_proc:
        try:
            tunnel_proc.terminate()
            tunnel_proc.wait(timeout=2.0)
        except Exception:
            try:
                tunnel_proc.kill()
            except Exception:
                pass
        tunnel_proc = None

    # Kill any orphaned cloudflared left behind by earlier server runs (once per server start)
    try:
        if getattr(launch_tunnel_process, "_swept", False):
            raise RuntimeError("already swept")
        launch_tunnel_process._swept = True
        subprocess.run(["taskkill", "/F", "/IM", "cloudflared.exe"],
                       capture_output=True, timeout=8,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception:
        pass

    cfg = load_tunnel_config()
    custom_token = (cfg.get("custom_token") or "").strip()
    custom_domain = (cfg.get("custom_domain") or "").strip()

    if custom_token:
        TUNNEL_STATE["is_permanent"] = True
        cmd = [cloudflared_bin, "tunnel", "run", "--token", custom_token]
        if custom_domain:
            CLOUDFLARE_HTTPS_URL = custom_domain if custom_domain.startswith("http") else f"https://{custom_domain}"
            TUNNEL_STATE["url"] = CLOUDFLARE_HTTPS_URL
            TUNNEL_STATE["status"] = "online"
            TUNNEL_STATE["last_healthy"] = time.time()
            update_portal_files(CLOUDFLARE_HTTPS_URL)
    else:
        TUNNEL_STATE["is_permanent"] = False
        cmd = [
            cloudflared_bin, "tunnel",
            "--url", "http://127.0.0.1:8000",
            "--ha-connections", "4",
            "--protocol", "http2",
            "--retries", "10",
            "--grace-period", "15s"
        ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        tunnel_proc = proc

        def reader():
            global CLOUDFLARE_HTTPS_URL
            for line in iter(proc.stdout.readline, ""):
                if not line:
                    break
                match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
                if match:
                    new_url = match.group(0)
                    CLOUDFLARE_HTTPS_URL = new_url
                    TUNNEL_STATE["url"] = new_url
                    TUNNEL_STATE["status"] = "online"
                    TUNNEL_STATE["last_healthy"] = time.time()
                    print(f"\n=======================================================")
                    print(f"[+] Nova Insight Cloudflare Tunnel Online & Protected:")
                    print(f"--> {new_url}")
                    print(f"=======================================================\n")

                    update_portal_files(new_url)
                    try:
                        with open(TUNNEL_STATUS_FILE, "w", encoding="utf-8") as sf:
                            json.dump({
                                "url": new_url,
                                "updated_at": time.time(),
                                "status": "online",
                                "reconnect_count": TUNNEL_STATE["reconnect_count"],
                                "is_permanent": TUNNEL_STATE["is_permanent"]
                            }, sf, indent=2)
                    except Exception:
                        pass

        threading.Thread(target=reader, daemon=True).start()

    except Exception as e:
        print("Tunnel launch error:", e)

def tunnel_watchdog_worker():
    """Continuous self-healing watchdog. Probes connection every 15s, auto-recovers on drops/530."""
    global TUNNEL_STATE, CLOUDFLARE_HTTPS_URL
    # Initial launch
    launch_tunnel_process()

    consecutive_failures = 0
    last_keepalive = 0

    while True:
        time.sleep(15)
        cfg = load_tunnel_config()
        if not cfg.get("auto_heal", True):
            continue

        active_url = CLOUDFLARE_HTTPS_URL
        if not active_url:
            consecutive_failures += 1
            if consecutive_failures >= 3:
                print("[!] Watchdog: Tunnel URL missing. Re-launching connector...")
                TUNNEL_STATE["reconnect_count"] += 1
                launch_tunnel_process()
                consecutive_failures = 0
            continue

        # Active probe to verify Cloudflare edge is genuinely routing traffic
        health_check_url = f"{active_url}/api/health"
        is_healthy = False
        try:
            with httpx.Client(timeout=7.0) as client:
                r = client.get(health_check_url)
                if r.status_code == 200:
                    is_healthy = True
        except Exception:
            is_healthy = False

        TUNNEL_STATE["last_check"] = time.time()

        if is_healthy:
            consecutive_failures = 0
            TUNNEL_STATE["status"] = "online"
            TUNNEL_STATE["last_healthy"] = time.time()

            # Every 45 seconds, send a lightweight keep-alive request so edge socket never goes idle
            now = time.time()
            if now - last_keepalive > 45:
                last_keepalive = now
                try:
                    with httpx.Client(timeout=5.0) as client:
                        client.get(f"{active_url}/api/models")
                except Exception:
                    pass

        else:
            consecutive_failures += 1
            TUNNEL_STATE["status"] = "degraded"
            print(f"[!] Watchdog: Tunnel probe failed ({consecutive_failures}/2) for {active_url}")

            # Restarting a free tunnel gives a NEW public URL, which breaks installed apps and
            # bookmarks. If cloudflared is still running it reconnects by itself after a Wi-Fi
            # blip with the SAME URL, so only force a restart when it died or stayed down ~2 min.
            proc_alive = tunnel_proc is not None and tunnel_proc.poll() is None
            needed_failures = 8 if proc_alive else 2
            if consecutive_failures >= needed_failures:
                print(f"[!] Watchdog: Cloudflare connection lost (530/timeout). Auto-healing tunnel now...")
                TUNNEL_STATE["reconnect_count"] += 1
                TUNNEL_STATE["status"] = "recovering"
                launch_tunnel_process()
                consecutive_failures = 0
                time.sleep(4)

# Start watchdog in background daemon thread (home laptop only).
# When hosted (Render) the platform already provides a permanent HTTPS URL, so no tunnel is needed.
if CLOUD_MODE:
    _public_url = (os.environ.get("RENDER_EXTERNAL_URL") or os.environ.get("KAZAI_PUBLIC_URL") or "").strip().rstrip("/")
    CLOUDFLARE_HTTPS_URL = _public_url or None
    TUNNEL_STATE.update({"url": CLOUDFLARE_HTTPS_URL, "status": "online", "is_permanent": True,
                         "last_healthy": time.time(), "watchdog_active": False})

    def _cloud_self_ping():
        """Free hosting sleeps after ~15 min without traffic. A light ping every 4 min keeps it awake."""
        while True:
            time.sleep(240)
            if not _public_url:
                continue
            try:
                with httpx.Client(timeout=15.0) as client:
                    client.get(f"{_public_url}/api/health")
                TUNNEL_STATE["last_healthy"] = time.time()
            except Exception:
                pass

    if os.environ.get("KAZAI_SELF_PING", "1") != "0":
        threading.Thread(target=_cloud_self_ping, daemon=True).start()
else:
    threading.Thread(target=tunnel_watchdog_worker, daemon=True).start()

def get_local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

@app.get("/manifest.json")
async def serve_manifest():
    manifest_file = os.path.join(static_dir, "manifest.json")
    if os.path.exists(manifest_file):
        return FileResponse(manifest_file, media_type="application/manifest+json")
    raise HTTPException(status_code=404)

@app.get("/sw.js")
async def serve_sw():
    sw_file = os.path.join(static_dir, "sw.js")
    if os.path.exists(sw_file):
        return FileResponse(sw_file, media_type="application/javascript")
    raise HTTPException(status_code=404)

@app.get("/api/mobile-info")
async def get_mobile_info(request: Request):
    ip = get_local_ip()
    port = request.url.port or 8000
    local_url = f"http://{ip}:{port}"
    https_url = CLOUDFLARE_HTTPS_URL
    
    # Prefer HTTPS URL so Chrome on Android and Safari on iOS get Secure Context for PWA installation
    primary_url = https_url if https_url else local_url
    
    svg_qr = ""
    try:
        import qrcode
        import qrcode.image.svg
        factory = qrcode.image.svg.SvgPathImage
        img = qrcode.make(primary_url, image_factory=factory, box_size=10, border=1)
        svg_qr = img.to_string().decode("utf-8")
    except Exception as e:
        print("QR generation error:", e)

    return {
        "ip": ip,
        "port": port,
        "url": primary_url,
        "https_url": https_url,
        "local_url": local_url,
        "is_https": bool(https_url),
        "qr_svg": svg_qr
    }

class TunnelConfigRequest(BaseModel):
    custom_token: Optional[str] = ""
    custom_domain: Optional[str] = ""
    auto_heal: Optional[bool] = True
    keep_awake: Optional[bool] = True
    autostart_enabled: Optional[bool] = True

@app.get("/api/tunnel-status")
async def get_tunnel_status():
    cfg = load_tunnel_config()
    ip = get_local_ip()
    return {
        "status": TUNNEL_STATE["status"],
        "url": CLOUDFLARE_HTTPS_URL,
        "local_url": f"http://{ip}:8000",
        "ip": ip,
        "is_permanent": TUNNEL_STATE["is_permanent"],
        "reconnect_count": TUNNEL_STATE["reconnect_count"],
        "last_healthy": TUNNEL_STATE["last_healthy"],
        "last_check": TUNNEL_STATE["last_check"],
        "auto_heal": cfg.get("auto_heal", True),
        "autostart_enabled": is_autostart_installed(),
        "custom_token_configured": bool((cfg.get("custom_token") or "").strip()),
        "custom_domain": cfg.get("custom_domain", ""),
        "computer_name": socket.gethostname()
    }

@app.post("/api/tunnel-config")
async def update_tunnel_config(req: TunnelConfigRequest):
    if CLOUD_MODE:
        raise HTTPException(status_code=403, detail="Not available on hosted servers")
    cfg = load_tunnel_config()
    token_changed = (req.custom_token != cfg.get("custom_token"))
    domain_changed = (req.custom_domain != cfg.get("custom_domain"))
    
    cfg["custom_token"] = (req.custom_token or "").strip()
    cfg["custom_domain"] = (req.custom_domain or "").strip()
    cfg["auto_heal"] = bool(req.auto_heal)
    cfg["keep_awake"] = bool(req.keep_awake)
    cfg["autostart_enabled"] = bool(req.autostart_enabled)
    save_tunnel_config(cfg)

    if req.autostart_enabled is not None:
        set_autostart(req.autostart_enabled)

    if token_changed or domain_changed:
        launch_tunnel_process()

    return {"success": True, "config": cfg}

@app.post("/api/tunnel-reconnect")
async def force_tunnel_reconnect():
    if CLOUD_MODE:
        raise HTTPException(status_code=403, detail="Not available on hosted servers")
    TUNNEL_STATE["reconnect_count"] += 1
    TUNNEL_STATE["status"] = "recovering"
    launch_tunnel_process()
    return {"success": True, "message": "Reconnecting tunnel now..."}

@app.post("/api/autostart/install")
async def install_autostart_api():
    if CLOUD_MODE:
        raise HTTPException(status_code=403, detail="Not available on hosted servers")
    success = set_autostart(True)
    return {"success": success, "installed": is_autostart_installed()}

@app.post("/api/autostart/uninstall")
async def uninstall_autostart_api():
    if CLOUD_MODE:
        raise HTTPException(status_code=403, detail="Not available on hosted servers")
    success = set_autostart(False)
    return {"success": success, "installed": is_autostart_installed()}

@app.get("/")
async def serve_index():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Nova Insight Web App static directory initializing..."}

app.mount("/static", StaticFiles(directory=static_dir), name="static")

