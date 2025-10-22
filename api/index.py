# api/index.py
from quart import Quart, request, jsonify
import httpx
import os

app = Quart(__name__)

# ===== CONFIG =====
FAM_API_URL = "https://westeros.famapp.in/txn/create/payout/add/"
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "YOUR_AUTH_TOKEN")
DEVICE_ID = os.getenv("DEVICE_ID", "YOUR_DEVICE_ID")
DEVICE_DETAILS = os.getenv(
    "DEVICE_DETAILS",
    "RMX2002 | Android 11 | Dalvik/2.1.0 | RMX2002L1 | A0A9F900EBF829949466A0CC2B04F395770149E7 | 3.11.5 (Build 525) | 1DAPK6BOLD"
)

HEADERS = {
    "User-Agent": DEVICE_DETAILS,
    "Accept-Encoding": "gzip",
    "Content-Type": "application/json; charset=UTF-8",
    "x-device-details": DEVICE_DETAILS,
    "x-app-version": "525",
    "x-platform": "1",
    "device-id": DEVICE_ID,
    "authorization": AUTH_TOKEN,
}

# ==================

@app.route("/")
async def index_route():
    return "FamPay Live UPI Lookup Proxy — Use /lookup?upi=username@fam"

@app.route("/lookup", methods=["GET", "POST"])
async def lookup():
    # Get UPI from POST JSON or GET param
    if request.method == "POST":
        data = await request.get_json(silent=True) or {}
        upi_id = data.get("upi")
    else:
        upi_id = request.args.get("upi")

    if not upi_id or "@fam" not in upi_id:
        return jsonify({"error": "Valid UPI ID required (e.g., kumarchx@fam)"}), 400

    payload = {
        "upi_string": f"upi://pay?pa={upi_id}",
        "init_mode": "00",
        "is_uploaded_from_gallery": False,
    }

    try:
        async with httpx.AsyncClient(http2=True, timeout=15.0) as client:
            resp = await client.post(FAM_API_URL, headers=HEADERS, json=payload)
            return jsonify(resp.json()), resp.status_code
    except httpx.HTTPStatusError as e:
        return (
            jsonify({"error": "FamPay API returned error", "status": e.response.status_code, "detail": e.response.text}),
            e.response.status_code,
        )
    except Exception as e:
        return jsonify({"error": "Request failed", "detail": str(e)}), 500

# No app.run() — Vercel detects `app` automatically
