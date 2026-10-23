
import os
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from google import genai


from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

app = Flask(__name__)


api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key) if api_key else None


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/scanner")
def scanner():
    return render_template("scanner.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    data = request.get_json(silent=True) or {}

    product_name = data.get("product_name", "Unknown product")
    category = data.get("category", "Other")
    ingredients = data.get("ingredients", "")

    if not isinstance(ingredients, str) or not ingredients.strip():
        return jsonify({
            "error": "Please enter the ingredient list."
        }), 400

    if client is None:
        return jsonify({
            "error": "Gemini API key is missing. Check your .env file."
        }), 500

    prompt = f"""
You are an ingredient information assistant for ToxinCheck.

Product name: {product_name}
Product category: {category}
Ingredient list: {ingredients}

Analyze the provided ingredient list.

Return:
1. A simple explanation of the listed ingredients.
2. Their common functions in the product.
3. Any evidence-based potential concerns and relevant context.
4. Practical precautions where appropriate.
5. Reliable sources or official references for further reading.

Do not claim that a product is completely safe or toxic based only
on its ingredient list. Do not invent sources or facts. Explain
uncertainty when evidence is insufficient. This is informational,
not medical advice.
"""

    try:
        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=prompt
        )

        result = response.text or "No analysis was returned."

        return jsonify({
            "analysis": {
                "product_name": product_name,
                "category": category,
                "ingredients": ingredients,
                "result": result
            }
        })

    except Exception:
        app.logger.exception("Gemini ingredient analysis failed")
        return jsonify({
            "error": "Ingredient analysis failed. Check your API setup and try again."
        }), 502


if __name__ == "__main__":
    app.run(debug=True)
