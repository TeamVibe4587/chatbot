import io
import os
import tempfile
import asyncio
from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai.types import Part
from dotenv import load_dotenv
import whisper
import librosa
import numpy as np 
import noisereduce as nr 
from gtts import gTTS
import soundfile as sf 
import torch 
 
# ---------- Load ENV ----------
load_dotenv()
gemini_key = os.getenv("GEMINI_API_KEY")
 
# ---------- FastAPI App ----------
app = FastAPI()
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
 
# === System Instruction بهینه‌سازی شده برای پاسخ‌های سریع و شرطی ===
system_instruction = (
    "شما یک دستیار هوش مصنوعی ایرانی هستید. "
    "وظیفه شما پاسخ دادن به سوالات کاربر به زبان فارسی است. "
    
    "**قانون عمومی:** در حالت عادی، پاسخ‌های شما باید مختصر و در حد یک یا دو خط باشند."
    
    "**قانون کد و جدول (حیاتی):** اگر کاربر درخواست کد یا جدول داد، قانون اختصار را نادیده بگیرید و پاسخ خود را *کامل* و *جامع* برگردانید. تمام محتوای پاسخ را به صورت زیر برگردانید: "
    "1. برای کد (مثل Python, HTML, JS)، *فقط* بلوک کد کامل را در ```[زبان]\n[کد کامل]``` قرار دهید. "
    "2. برای جدول‌ها، *فقط* ساختار کامل مارک‌داون را برگردانید و مطمئن شوید که *تمام* جوانب ضروری درخواستی کاربر را پوشش می‌دهید. "
    
    "**ممنوع:** از نوشتن هرگونه مقدمه یا موخره قبل یا بعد از بلوک کد/جدول، *اکیداً* خودداری کنید. "
    
    "**الگوی خروجی جدول (اجباری):** خروجی جدول شما *باید* دقیقاً شبیه این الگو باشد و هیچ ردیف یا ستونی نباید خالی بماند: "
    
    "| ویژگی | نام یک موجودیت | نام موجودیت دیگر |"
    "|---|---|---|"
    "| مورد اول | محتوای یک | محتوای دو |"
    "| مورد دوم | محتوای سه | محتوای چهار |"
    "| مورد سوم | محتوای پنج | محتوای شش |"
    
    "**لحن پاسخ خود را بر اساس لحن ورودی کاربر تنظیم کنید.**"
)
 
# ---------- Gemini Client ----------
try:
    client = genai.Client(api_key=gemini_key)
except Exception as e:
    print(f"FATAL: Gemini Client failed to initialize: {e}")
    client = None
 
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Whisper will use device: {DEVICE}")
 
# ---------- Whisper (load once) ----------
try:
    whisper_model = whisper.load_model("base", device=DEVICE) 
except Exception as e:
    print(f"WARNING: Whisper model failed to load: {e}")
    whisper_model = None
 
def cleanup_file(path: str):
    if os.path.exists(path):
        os.remove(path)
 
# --- CHAT (text & image analysis) ---
@app.post("/chat")
async def chat(message: str = Form(...), image: UploadFile | None = None):
    if not message.strip() and not image:
        return JSONResponse(status_code=400, content={"error": "پیام یا تصویر ارسالی خالی است."})
 
    contents = [Part.from_text(text=message)]
 
    if image:
        img_bytes = await image.read()
        contents.append(
            Part.from_bytes(
                data=img_bytes,
                mime_type=image.content_type
            )
        )
 
    try:
        if not client:
            raise Exception("Gemini client is not initialized.")
 
        resp = client.models.generate_content(
            model="gemini-2.5-flash", 
            contents=contents,
            config={"system_instruction": system_instruction}
        )
        text_out = getattr(resp, "text", None) or str(resp)
 
        if not text_out.strip():
            return JSONResponse(status_code=500, content={"error": "مدل پاسخ مناسبی نداد."})
 
    except Exception as e:
        print(f"Gemini Chat Error: {e}")
        return JSONResponse(status_code=500, content={"error": "خطا در برقراری ارتباط با مدل هوش مصنوعی."})
 
    return {"reply": text_out}
 
# --- STT (speech → text) ---
@app.post("/stt")
async def stt(audio: UploadFile = File(...)):
    if not whisper_model:
        return JSONResponse(status_code=500, content={"error": "Whisper model not loaded."})
 
    temp_dir = tempfile.gettempdir()
    temp_input_path = os.path.join(temp_dir, f"audio_in_{os.urandom(8).hex()}.webm")
    temp_output_path = os.path.join(temp_dir, f"audio_out_{os.urandom(8).hex()}.wav") 
 
    try:
        with open(temp_input_path, "wb") as f:
            f.write(await audio.read())
 
        y, sr = await asyncio.to_thread(librosa.load, temp_input_path, sr=16000)
        
        reduced_noise = await asyncio.to_thread(nr.reduce_noise, y=y, sr=sr) 
        
        await asyncio.to_thread(sf.write, temp_output_path, reduced_noise, sr)
 
        result = await asyncio.to_thread(
            whisper_model.transcribe,
            temp_output_path, 
            language="fa", 
            task="transcribe", 
            initial_prompt="سلام، وقتت بخیر. یه پیام صوتی ضبط کردم، می‌تونی دقیقاً متنشو برام بنویسی؟",
            temperature=0.0, 
            condition_on_previous_text=False
        )
        transcript = result["text"].strip()
        
        if not transcript:
            return JSONResponse(status_code=200, content={"transcript": "", "error": "گفتار قابل تشخیص نبود."})
            
        return {"transcript": transcript}
 
    except Exception as e:
        # مدیریت خطاهای کلی حین پردازش STT
        print(f"STT General Error: {e}")
        return JSONResponse(status_code=500, content={"error": "خطای عمومی در پردازش صوت."})
    
    finally:
        # تمیزکاری فایل‌های موقت، حتی اگر خطا رخ داده باشد
        cleanup_file(temp_input_path)
        cleanup_file(temp_output_path)
 
# --- TTS (text → speech) ---
# تابع کمکی synchronous برای gTTS
def generate_tts_sync(text, mp3_fp):
    tts_engine = gTTS(text=text, lang="fa")
    tts_engine.write_to_fp(mp3_fp)
 
@app.post("/tts")
async def tts(text: str = Form(...), background_tasks: BackgroundTasks = None):
    if not text or len(text) > 5000:
        return JSONResponse(status_code=400, content={"error": "متن ورودی نمی‌تواند خالی یا بیش از ۵۰۰۰ کاراکتر باشد."})
 
    mp3_fp = io.BytesIO()
 
    try:
        # اجرای عملیات مسدودکننده gTTS در یک ترد مجزا
        await asyncio.to_thread(generate_tts_sync, text, mp3_fp)
 
        mp3_fp.seek(0)
 
    except AssertionError:
        print("gTTS Error: AssertionError (Text might be empty or invalid)")
        return JSONResponse(status_code=500, content={"error": "gTTS خطا داد: متن نامعتبر است."})
 
    except Exception as e:
        print(f"gTTS General Error: {e}")
        return JSONResponse(status_code=500, content={"error": f"TTS conversion failed: {e}"})
 
    temp_dir = tempfile.gettempdir()
    temp_filename = os.path.join(temp_dir, f"tts_{os.urandom(8).hex()}.mp3")
 
    try:
        # نوشتن محتوای باینری در فایل موقت
        with open(temp_filename, "wb") as tmp_file:
            tmp_file.write(mp3_fp.read())
 
        # افزودن وظیفه حذف فایل پس از ارسال به کاربر
        background_tasks.add_task(cleanup_file, temp_filename)
 
        return FileResponse(
            temp_filename, 
            media_type="audio/mpeg", 
            filename="tts.mp3"
        )
    except Exception as e:
        print(f"File handling error in TTS: {e}")
        return JSONResponse(status_code=500, content={"error": "خطا در مدیریت فایل صوتی تولید شده."})
 
#uvicorn app:app --reload