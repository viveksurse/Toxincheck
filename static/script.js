
const camera = document.getElementById("camera");
const photo = document.getElementById("photo");
const canvas = document.getElementById("photoCanvas");
const placeholder = document.getElementById("cameraPlaceholder");

const startCameraBtn = document.getElementById("startCamera");
const captureBtn = document.getElementById("capturePhoto");
const retakeBtn = document.getElementById("retakePhoto");
const uploadInput = document.getElementById("uploadPhoto");

const statusText = document.getElementById("scannerStatus");
const ingredientsInput = document.getElementById("ingredients");
const ingredientForm = document.getElementById("ingredientForm");
const resultBox = document.getElementById("analysisResult");
const clearBtn = document.getElementById("clearForm");

let cameraStream = null;
let currentImageUrl = null;

function setStatus(message) {
    statusText.textContent = message;
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    camera.srcObject = null;
    captureBtn.disabled = true;
    startCameraBtn.disabled = false;
}

function showImage(imageUrl) {
    photo.src = imageUrl;
    photo.hidden = false;
    camera.hidden = true;
    placeholder.hidden = true;
    retakeBtn.hidden = false;
}

async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus("Camera access is unavailable. Open the website on localhost or HTTPS, or upload a photo.");
        return;
    }

    stopCamera();
    setStatus("Requesting camera permission...");

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" }
            },
            audio: false
        });

        camera.srcObject = cameraStream;
        camera.hidden = false;
        photo.hidden = true;
        placeholder.hidden = true;
        retakeBtn.hidden = true;

        await camera.play();

        captureBtn.disabled = false;
        startCameraBtn.disabled = true;
        setStatus("Camera ready. Hold the ingredient label steady and capture it.");
    } catch (error) {
        stopCamera();

        if (error.name === "NotAllowedError") {
            setStatus("Camera permission was denied. Allow camera access in your browser settings.");
        } else if (error.name === "NotFoundError") {
            setStatus("No camera was found. Try uploading a photo instead.");
        } else {
            setStatus("Could not open the camera. Check browser permissions or upload a photo.");
        }
    }
}

function capturePhoto() {
    if (!cameraStream || !camera.videoWidth) {
        setStatus("Wait for the camera to become ready.");
        return;
    }

    canvas.width = camera.videoWidth;
    canvas.height = camera.videoHeight;

    const context = canvas.getContext("2d");
    context.drawImage(camera, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => {
        if (!blob) {
            setStatus("Could not capture the photo. Please try again.");
            return;
        }

        if (currentImageUrl) {
            URL.revokeObjectURL(currentImageUrl);
        }

        currentImageUrl = URL.createObjectURL(blob);
        showImage(currentImageUrl);
        stopCamera();

        setStatus("Photo captured. Preparing ingredient text extraction...");
        extractText(blob);
    }, "image/jpeg", 0.92);
}

async function handleUploadedPhoto(file) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
        setStatus("Please select an image file.");
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        setStatus("Please choose an image smaller than 10 MB.");
        return;
    }

    stopCamera();

    if (currentImageUrl) {
        URL.revokeObjectURL(currentImageUrl);
    }

    currentImageUrl = URL.createObjectURL(file);
    showImage(currentImageUrl);

    setStatus("Photo selected. Preparing ingredient text extraction...");
    await extractText(file);
}

async function extractText(imageFile) {
    setStatus("Preparing image for ingredient recognition...");

    let imageUrl = null;

    try {
        if (!window.Tesseract) {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src =
                    "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
                script.onload = resolve;
                script.onerror = () =>
                    reject(new Error("Could not load text recognition."));
                document.head.appendChild(script);
            });
        }

        const image = new Image();
        imageUrl = URL.createObjectURL(imageFile);

        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
            image.src = imageUrl;
        });

        const scale = Math.min(2, 2400 / Math.max(image.width, image.height));
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext("2d");
        context.filter = "grayscale(100%) contrast(150%)";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        context.filter = "none";

        URL.revokeObjectURL(imageUrl);
        imageUrl = null;

        setStatus("Reading the label. Please wait...");

        const result = await window.Tesseract.recognize(canvas, "eng", {
            logger: event => {
                if (
                    event.status === "recognizing text" &&
                    event.progress != null
                ) {
                    setStatus(
                        `Reading label: ${Math.round(event.progress * 100)}%`
                    );
                }
            }
        });

        const extractedText = result.data.text.replace(/\r/g, "\n").trim();

        const usefulText = extractedText
            .split("\n")
            .map(line => line.trim())
            .filter(line => /[a-zA-Z]{2,}/.test(line))
            .join("\n");

        if (usefulText.length >= 5) {
            ingredientsInput.value = usefulText;
            ingredientsInput.dispatchEvent(
                new Event("input", { bubbles: true })
            );

            setStatus(
                "Text extracted. Check it against the original label and correct any mistakes."
            );
        } else {
            ingredientsInput.value = "";
            setStatus(
                "The label was not readable enough. Use brighter light, " +
                "capture the ingredient text closely, or type it manually."
            );
        }
    } catch (error) {
        console.error("OCR error:", error);
        setStatus(
            "Text recognition failed. Check your internet connection or type the ingredients manually."
        );
    } finally {
        if (imageUrl) {
            URL.revokeObjectURL(imageUrl);
        }
    }
}

// Format Gemini Markdown safely without inserting raw HTML.
function displayAnalysis(markdown) {
    resultBox.replaceChildren();

    const lines = markdown.replace(/\r/g, "").split("\n");
    let list = null;

    function flushList() {
        if (list) {
            resultBox.appendChild(list);
            list = null;
        }
    }

    function appendInlineText(parent, text) {
        const pattern = /(\*\*[^*]+\*\*|https?:\/\/[^\s<>()]+|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(text)) !== null) {
            parent.appendChild(
                document.createTextNode(text.slice(lastIndex, match.index))
            );

            const token = match[0];

            if (token.startsWith("**")) {
                const strong = document.createElement("strong");
                strong.textContent = token.slice(2, -2);
                parent.appendChild(strong);
            } else {
                let label = token;
                let url = token;

                const markdownLink = token.match(
                    /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/
                );

                if (markdownLink) {
                    label = markdownLink[1];
                    url = markdownLink[2];
                }

                // Only allow safe web links.
                try {
                    const parsedUrl = new URL(url);

                    if (!["https:", "http:"].includes(parsedUrl.protocol)) {
                        parent.appendChild(document.createTextNode(token));
                    } else {
                        const link = document.createElement("a");
                        link.href = parsedUrl.href;
                        link.textContent = label;
                        link.target = "_blank";
                        link.rel = "noopener noreferrer";
                        parent.appendChild(link);
                    }
                } catch {
                    parent.appendChild(document.createTextNode(token));
                }
            }

            lastIndex = pattern.lastIndex;
        }

        parent.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line || /^---+$/.test(line)) {
            flushList();
            continue;
        }

        const heading = line.match(/^#{1,4}\s+(.+)$/);

        if (heading) {
            flushList();
            const element = document.createElement("h3");
            appendInlineText(element, heading[1].replace(/\*\*/g, ""));
            resultBox.appendChild(element);
            continue;
        }

        const bullet = line.match(/^[-*]\s+(.+)$/);

        if (bullet) {
            if (!list) {
                list = document.createElement("ul");
            }

            const item = document.createElement("li");
            appendInlineText(item, bullet[1]);
            list.appendChild(item);
            continue;
        }

        flushList();

        const paragraph = document.createElement("p");
        appendInlineText(paragraph, line);
        resultBox.appendChild(paragraph);
    }

    flushList();
}

startCameraBtn.addEventListener("click", startCamera);
captureBtn.addEventListener("click", capturePhoto);

retakeBtn.addEventListener("click", () => {
    photo.hidden = true;
    placeholder.hidden = false;
    retakeBtn.hidden = true;
    startCamera();
});

uploadInput.addEventListener("change", event => {
    handleUploadedPhoto(event.target.files[0]);
    event.target.value = "";
});

clearBtn.addEventListener("click", () => {
    ingredientForm.reset();
    resultBox.hidden = true;
    resultBox.replaceChildren();
    ingredientsInput.value = "";

    if (currentImageUrl) {
        URL.revokeObjectURL(currentImageUrl);
        currentImageUrl = null;
    }

    photo.removeAttribute("src");
    photo.hidden = true;
    camera.hidden = true;
    placeholder.hidden = false;
    retakeBtn.hidden = true;

    stopCamera();
    setStatus("Cleared. Open the camera or upload another photo.");
});

ingredientForm.addEventListener("submit", async event => {
    event.preventDefault();

    const category = document.getElementById("category").value;
    const productName = document.getElementById("productName").value.trim();
    const ingredients = ingredientsInput.value.trim();

    if (!category || !ingredients) {
        setStatus("Please select a category and enter the ingredients.");
        return;
    }

    resultBox.hidden = false;
    resultBox.textContent = "Sending ingredients for analysis...";
    setStatus("Analyzing ingredients with Gemini. Please wait...");

    try {
        const response = await fetch("/api/analyze", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                category,
                product_name: productName,
                ingredients
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Analysis request failed.");
        }

        const analysis = data.analysis;
        const analysisText =
            typeof analysis === "string"
                ? analysis
                : analysis?.result;

        if (!analysisText) {
            throw new Error("The server returned no analysis text.");
        }

        displayAnalysis(analysisText);
        setStatus("Ingredient analysis completed.");
    } catch (error) {
        console.error("Analysis error:", error);
        resultBox.textContent =
            "Could not complete ingredient analysis. " + error.message;
        setStatus("Analysis failed. Please check the server and try again.");
    }
});

window.addEventListener("beforeunload", stopCamera);
