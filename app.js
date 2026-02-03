const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-button");
const chatLog = document.getElementById("chat-history");
const recordBtn = document.getElementById("record-button");
const imageInput = document.getElementById("image-upload");
const imagePreviewArea = document.getElementById("image-preview-area");
const imagePreview = document.getElementById("image-preview");
const clearImageBtn = document.getElementById("clear-image-button");
const codeModal = document.getElementById("code-modal");
const modalContentPre = document.getElementById("modal-content-pre");
const closeModalBtn = document.querySelector(".close-button");
const copyCodeBtn = document.getElementById("copy-code-button");

const API_URL = "http://127.0.0.1:8000";

let isRecording = false;
let mediaRecorder;
let audioChunks = [];

let lastModalContent = null;



function displayContentInModal(content, isCode = true) {
    lastModalContent = content;

    codeModal.style.display = "block";
    codeModal.classList.add('is-open');

    // === منطق نمایش: اگر جدول است، آن را به HTML ساده تبدیل کن ===
    if (content.trim().startsWith('```')) {
        copyCodeBtn.innerHTML = '<i class="fas fa-copy"></i> کپی کد';
        modalContentPre.style.direction = 'ltr';
        modalContentPre.style.textAlign = 'left';

        // محتوای کد را در textContent می‌ریزیم تا تگ‌های HTML اجرا نشوند
        modalContentPre.textContent = content;

    } else {
        copyCodeBtn.innerHTML = '<i class="fas fa-copy"></i> کپی جدول';
        modalContentPre.style.direction = 'rtl';
        modalContentPre.style.textAlign = 'right';

        // === تبدیل مارک‌داون جدول به HTML ساده (سفارشی و قوی) ===
        const tableHTML = convertMarkdownTableToHTML(content);
        modalContentPre.innerHTML = tableHTML;
    }
}

function convertMarkdownTableToHTML(markdown) {
    const lines = markdown.split('\n').map(line => line.trim()).filter(line => line.startsWith('|'));

    if (lines.length < 2) return markdown;

    let html = '<table class="ai-table">';
    const headerLine = lines[0];
    const headerCells = headerLine.split('|').map(c => c.trim()).filter(c => c);
    html += '<thead><tr>';
    headerCells.forEach(cell => {
        html += `<th>${cell}</th>`;
    });
    html += '</tr></thead><tbody>';

    const dataLines = lines.slice(2);
    dataLines.forEach(line => {
        const dataCells = line.split('|').map(c => c.trim()).filter(c => c);
        if (dataCells.length === headerCells.length) {
            html += '<tr>';
            dataCells.forEach(cell => {
                html += `<td>${cell}</td>`;
            });
            html += '</tr>';
        }
    });

    html += '</tbody></table>';
    return html;
}
closeModalBtn.onclick = () => {
    codeModal.style.display = "none";
    codeModal.classList.remove('is-open');
};

window.onclick = (event) => {
    if (event.target == codeModal) {
        codeModal.style.display = "none";
        codeModal.classList.remove('is-open');
    }
};

copyCodeBtn.onclick = async() => {
    const textToCopy = modalContentPre.textContent;
    try {
        await navigator.clipboard.writeText(textToCopy);
        copyCodeBtn.textContent = 'کپی شد!';
        setTimeout(() => {

            copyCodeBtn.innerHTML = copyCodeBtn.textContent.includes('کد') ? '<i class="fas fa-copy"></i> کپی کد' : '<i class="fas fa-copy"></i> کپی متن';
        }, 1500);
    } catch (err) {
        console.error('Failed to copy text: ', err);
    }
};

/**
 * @param {string} reply پاسخ متنی کامل از مدل
 */
function processAndDisplayResponse(reply) {
    const codeBlockRegex = /(```[\s\S]*?```)/;


    const tableRegex = /(\|.*\|[\r\n]\|.*---[\s\S]*)/s;

    const isCode = codeBlockRegex.test(reply);
    const isTable = !isCode && tableRegex.test(reply);

    let contentToDisplayInModal = null;
    let modalMessage = "";

    if (isCode) {
        contentToDisplayInModal = reply.match(codeBlockRegex)[1];
        modalMessage = "کد در **پنجره‌ای مجزا** نمایش داده شد.";
    } else if (isTable) {
        contentToDisplayInModal = reply.match(tableRegex)[1];
        modalMessage = "جدول در **پنجره‌ای مجزا** نمایش داده شد.";
    } else {
        addMessage("AI", reply);
        return;
    }

    const msgDiv = addMessage("AI", modalMessage, false, false, contentToDisplayInModal);

    displayContentInModal(contentToDisplayInModal, isCode);
}


// ********************* توابع اصلی چت *********************

async function handleTTS(text) {
    // منطق handleTTS دست نخورده باقی می ماند
    console.log("در حال درخواست TTS...");

    const formData = new FormData();
    formData.append('text', text);

    try {
        const response = await fetch(`${API_URL}/tts`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`TTS API failed with status ${response.status}: ${errorText}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        await audio.play();

    } catch (error) {
        console.error("خطا در تبدیل متن به گفتار:", error);
    }
}

/**
 *نمایش پیام در چت.
 *@param {string} role نقش (شما/AI).
 *@param {string} content محتوای پیام (متن، URL تصویر، رونویسی صوت).
 *@param {boolean} isAudio آیا پیام یک متن رونویسی شده از صوت است؟
 *@param {boolean} isImage آیا محتوا یک URL تصویر ارسالی است؟
 *@param {string} modalContentToStore محتوای کد/جدول برای نمایش مجدد در مُدال.
 *@returns {HTMLElement} المان پیام ایجاد شده.
 */
function addMessage(role, content, isAudio = false, isImage = false, modalContentToStore = null) {
    const roleLabel = role === "شما" ? "شما:" : "AI:";
    const roleClass = role === "شما" ? "user-message" : "bot-message";

    const msgDiv = document.createElement("div");
    msgDiv.classList.add("message", roleClass);

    const labelSpan = document.createElement("span");
    labelSpan.classList.add("user-label");
    labelSpan.textContent = roleLabel;
    msgDiv.appendChild(labelSpan);

    if (isImage) {
        const img = document.createElement("img");
        img.src = content;
        img.alt = "تصویر ارسالی";
        img.classList.add("sent-image");
        msgDiv.appendChild(img);

    } else if (isAudio) {
        const audioPlaceholder = document.createElement("span");
        audioPlaceholder.classList.add("audio-placeholder");
        audioPlaceholder.innerHTML = `<i class="fas fa-volume-up"></i> ${content}`;
        msgDiv.appendChild(audioPlaceholder);

    } else {
        const textSpan = document.createElement("span");
        textSpan.classList.add("text");
        textSpan.textContent = content;
        msgDiv.appendChild(textSpan);

        if (role === "AI") {
            const ttsButton = document.createElement("button");
            ttsButton.classList.add("tts-button");
            ttsButton.innerHTML = '<i class="fas fa-volume-up"></i>';
            ttsButton.title = "پخش پاسخ AI";

            ttsButton.addEventListener('click', () => {
                handleTTS(content);
            });

            msgDiv.appendChild(ttsButton);
        }
    }

    // === منطق اضافه کردن دکمه "مشاهده مجدد کد" ===
    if (role === "AI" && modalContentToStore) {
        const viewCodeButton = document.createElement("button");
        viewCodeButton.classList.add("view-code-button");
        viewCodeButton.innerHTML = '<i class="fas fa-eye"></i> مشاهده مجدد';
        viewCodeButton.title = "باز کردن کد یا جدول در پنجره مجزا";


        viewCodeButton.addEventListener('click', () => {
            const isCode = modalContentToStore.startsWith('```');
            displayContentInModal(modalContentToStore, isCode);
        });

        const buttonWrapper = document.createElement('div');
        buttonWrapper.style.width = '100%';
        buttonWrapper.appendChild(viewCodeButton);

        msgDiv.appendChild(buttonWrapper);
    }

    chatLog.appendChild(msgDiv);
    chatLog.scrollTop = chatLog.scrollHeight;

    return msgDiv;
}

async function processChatResponse(resp) {
    if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ error: `خطای سرور: کد ${resp.status}` }));
        throw new Error(errorData.error || `خطای نامشخص با کد ${resp.status}`);
    }
    const data = await resp.json();
    return data.reply;
}

async function handleChatOrMultimodal(msg, imageFile) {
    // ... (بقیه منطق دست نخورده باقی می ماند)
    const formData = new FormData();
    formData.append("message", msg);

    if (imageFile) {
        formData.append("image", imageFile);

        const tempImageUrl = URL.createObjectURL(imageFile);
        addMessage("شما", tempImageUrl, false, true);
        addMessage("شما", msg || "[تصویر ارسالی برای تحلیل]");
    } else {
        addMessage("شما", msg);
    }

    try {
        const resp = await fetch(`${API_URL}/chat`, {
            method: "POST",
            body: formData
        });

        const reply = await processChatResponse(resp);

        // استفاده از تابع جدید برای نمایش پاسخ
        processAndDisplayResponse(reply);

    } catch (err) {
        console.error("خطا در ارسال پیام:", err.message);
        addMessage("AI", `خطا: ${err.message}`);
    }
}

// ********************* Event Listeners *********************

sendBtn.addEventListener("click", async() => {
    const msg = messageInput.value.trim();
    const imageFile = imageInput.files[0];

    if (!msg && !imageFile) {
        console.warn("لطفاً پیام یا تصویر وارد کنید.");
        return;
    }

    await handleChatOrMultimodal(msg, imageFile);

    messageInput.value = "";
    imageInput.value = null;
    imagePreview.src = "";
    imagePreviewArea.style.display = 'none';
});

recordBtn.addEventListener("click", async() => {
    // ... (بقیه منطق ضبط صوت دست نخورده باقی می ماند)
    if (isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        recordBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        recordBtn.classList.remove("recording");
        return;
    }

    isRecording = true;
    recordBtn.innerHTML = '<i class="fas fa-stop"></i>';
    recordBtn.classList.add("recording");
    audioChunks = [];

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

        mediaRecorder.ondataavailable = event => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async() => {
            isRecording = false;
            recordBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            recordBtn.classList.remove("recording");

            const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
            const formData = new FormData();
            formData.append("audio", audioBlob, "voice.webm");

            addMessage("AI", "در حال پردازش صوت و رونویسی...");

            try {
                // الف. ارسال به STT (Speech to Text)
                const respSTT = await fetch(`${API_URL}/stt`, {
                    method: "POST",
                    body: formData
                });

                const dataSTT = await respSTT.json();
                const transcript = dataSTT.transcript || dataSTT.error;

                addMessage("شما", transcript, true, false);

                if (transcript && !dataSTT.error) {
                    // ب. ارسال متن رونویسی شده به Chat
                    const chatFormData = new FormData();
                    chatFormData.append("message", transcript);

                    const chatResp = await fetch(`${API_URL}/chat`, {
                        method: "POST",
                        body: chatFormData
                    });

                    const reply = await processChatResponse(chatResp);

                    // استفاده از تابع جدید برای نمایش پاسخ
                    processAndDisplayResponse(reply);

                } else {
                    addMessage("AI", transcript || "گفتار قابل تشخیص نبود. لطفاً دوباره تلاش کنید.");
                }

            } catch (err) {
                console.error("خطا در پردازش صوت و چت:", err.message);
                addMessage("AI", `خطای جدی در سیستم صوت: ${err.message}`);
            }
        };

        mediaRecorder.start();

    } catch (err) {
        console.error("خطا در دسترسی به میکروفون:", err);
        isRecording = false;
        recordBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        recordBtn.classList.remove("recording");
        addMessage("AI", "خطا: دسترسی به میکروفون رد شد.");
    }
});

imageInput.addEventListener("change", (event) => {
    const file = event.target.files[0];

    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.src = e.target.result;
            imagePreviewArea.style.display = 'flex';
        };
        reader.readAsDataURL(file);
    } else {
        imagePreview.src = "";
        imagePreviewArea.style.display = 'none';
    }
});

// === قابلیت‌های عمومی ===
messageInput.addEventListener("keypress", (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendBtn.click();
    }
});

if (clearImageBtn) {
    clearImageBtn.addEventListener("click", () => {
        imageInput.value = null;
        imagePreview.src = "";
        imagePreviewArea.style.display = 'none';
    });
}